import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { type ReplyRule, type SimulatedAction, simulateMessage } from './customer-service-simulation'
import type {
  CustomerConversation,
  CustomerPendingTask,
  CustomerRule,
  CustomerRuleDraft,
  CustomerServiceEvent,
  CustomerServiceReply,
  CustomerServiceRequest,
  CustomerServiceSnapshot
} from './customer-service-types'
import type { ShopBrowserAuthority } from './shop-browser-profiles'
import type { ShopBrowserProfile } from './shop-browser-types'

interface Authority extends ShopBrowserAuthority {
  profile: ShopBrowserProfile
}
interface Store {
  version: 1
  revision: number
  rules: CustomerRule[]
  conversations: CustomerConversation[]
  tasks: CustomerPendingTask[]
  messages: { id: string; conversationId: string }[]
  events: CustomerServiceEvent[]
}
interface Dependencies {
  root: string
  authorize(profileId: string): Promise<Authority>
  isCurrent(): boolean
}

// Serialize file transactions across renderer sessions in this main process.
const queues = new Map<string, Promise<unknown>>()
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)

const fail = (code: string): never => {
  throw new Error(code)
}

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()

const int32 = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647

/** Recovered editor validation and action construction, IntentRuleEditWindow
 * WMrIsio5fr and DLPIBDvoEy. Keywords are only trimmed by the native editor. */
export function nativeCustomerRule(draft: CustomerRuleDraft, id: string): CustomerRule {
  if (
    !draft ||
    !text(draft.name) ||
    !text(draft.reply) ||
    !int32(draft.priority) ||
    !int32(draft.cooldownSeconds) ||
    typeof draft.keywords !== 'string' ||
    !['keyword_any', 'exact_match'].includes(draft.matchType) ||
    ['enabled', 'stopProcessing', 'doNotInvite', 'transferHuman', 'processEvaluatedClaim'].some(
      key => typeof draft[key] !== 'boolean'
    )
  ) {
    return fail('CUSTOMER_RULE_INVALID')
  }

  const actions: { type: SimulatedAction; template?: string; value?: boolean }[] = [
    { type: 'send_message', template: draft.reply.trim() }
  ]

  if (draft.doNotInvite) {
    actions.push({ type: 'set_do_not_invite', value: true })
  }

  if (draft.transferHuman) {
    actions.push({ type: 'transfer_human' })
  }

  if (draft.processEvaluatedClaim) {
    actions.push({ type: 'process_evaluated_claim' })
  }

  return {
    id,
    IntentName: draft.name.trim(),
    SortOrder: draft.priority,
    Keywords: draft.keywords.trim(),
    ReplyText: draft.reply.trim(),
    Enabled: draft.enabled ? 1 : 0,
    MatchType: draft.matchType,
    ActionsJson: JSON.stringify(actions),
    CooldownSeconds: draft.cooldownSeconds,
    StopProcessing: draft.stopProcessing
  }
}

const authorityKey = (value: Authority) =>
  JSON.stringify([value.origin, value.tenantId, value.principalId, value.profile.id, value.profile.shopId])

const emptyStore = (): Store => ({
  version: 1,
  revision: 0,
  rules: [],
  conversations: [],
  tasks: [],
  messages: [],
  events: []
})

/** Private, durable desktop rehearsal. Dependencies expose identity/profile
 * lookup only. There is no message, payment or native gateway transport. */
export class CustomerServicePreview {
  constructor(private readonly deps: Dependencies) {}

  private assertCurrent() {
    if (!this.deps.isCurrent()) {
      fail('CUSTOMER_OWNER_CHANGED')
    }
  }

  private async authority(profileId: string) {
    this.assertCurrent()
    const authority = await this.deps.authorize(profileId)
    this.assertCurrent()
    const { profile } = authority

    if (
      !authority.origin ||
      !authority.tenantId ||
      !authority.principalId ||
      profile.id !== profileId ||
      profile.tenantId !== authority.tenantId ||
      profile.principalId !== authority.principalId
    ) {
      fail('CUSTOMER_FORBIDDEN')
    }

    return authority
  }

  operate(request: CustomerServiceRequest): Promise<CustomerServiceReply> {
    const previous = queues.get(this.deps.root) ?? Promise.resolve()

    const operation = previous
      .then(() => this.perform(request))
      .catch(error => ({
        ok: false,
        error: error instanceof Error ? error.message : 'CUSTOMER_FAILED'
      }))

    queues.set(this.deps.root, operation)
    void operation.finally(() => {
      if (queues.get(this.deps.root) === operation) {
        queues.delete(this.deps.root)
      }
    })

    return operation
  }

  private async read(file: string): Promise<Store> {
    let raw: string

    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyStore()
      }

      throw error
    }

    const store = JSON.parse(raw) as Store

    if (
      store.version !== 1 ||
      !Number.isSafeInteger(store.revision) ||
      store.revision < 0 ||
      !['rules', 'conversations', 'tasks', 'messages', 'events'].every(key => Array.isArray(store[key]))
    ) {
      fail('CUSTOMER_STORE_INVALID')
    }

    return store
  }

  private async save(file: string, store: Store, authority: Authority) {
    const current = await this.authority(authority.profile.id)

    if (authorityKey(current) !== authorityKey(authority)) {
      fail('CUSTOMER_OWNER_CHANGED')
    }

    await fs.mkdir(this.deps.root, { recursive: true })
    const temporary = path.join(this.deps.root, `${randomUUID()}.tmp`)

    try {
      await fs.writeFile(temporary, JSON.stringify(store, null, 2), { flag: 'wx', mode: 0o600 })
      this.assertCurrent()
      await fs.rename(temporary, file)
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  private event(store: Store, conversationId: string, action: string, detail: string, messageId?: string) {
    store.events.push({
      id: randomUUID(),
      at: Date.now(),
      conversationId,
      action,
      detail,
      ...(messageId ? { messageId } : {})
    })
  }

  private simulate(store: Store, request: CustomerServiceRequest, authority: Authority): boolean {
    const message = request.message

    if (!message || !text(message.conversationId) || !text(message.messageId) || !text(message.text)) {
      fail('CUSTOMER_MESSAGE_INVALID')
    }

    if (!Number.isFinite(message.timestampMs) || message.timestampMs <= 0 || message.timestampMs > 8640000000000000) {
      fail('CUSTOMER_TIMESTAMP_REQUIRED')
    }

    const previous = store.messages.find(item => item.id === message.messageId)

    if (previous) {
      if (previous.conversationId !== message.conversationId) {
        fail('CUSTOMER_MESSAGE_CONFLICT')
      }

      return true
    }

    let conversation = store.conversations.find(item => item.id === message.conversationId)

    if (!conversation) {
      conversation = { id: message.conversationId, mode: 'auto', version: 0, lastMatched: [] }
      store.conversations.push(conversation)
    }

    store.messages.push({ id: message.messageId, conversationId: message.conversationId })
    this.event(store, conversation.id, 'incoming_message', message.text, message.messageId)

    if (conversation.mode !== 'auto') {
      this.event(store, conversation.id, 'suppressed', conversation.mode, message.messageId)

      return false
    }

    const shopId = authority.profile.shopId ?? authority.profile.id

    const rules: ReplyRule[] = store.rules.map((rule, order) => ({
      id: rule.id,
      order,
      tenantId: authority.tenantId,
      shopId,
      name: rule.IntentName,
      priority: rule.SortOrder,
      enabled: rule.Enabled === 1,
      matchType: rule.MatchType,
      keywords: rule.Keywords.split(/[\n,，]/)
        .map(word => word.trim())
        .filter(Boolean),
      reply: rule.ReplyText,
      cooldownSeconds: rule.CooldownSeconds,
      stopProcessing: rule.StopProcessing,
      actions: JSON.parse(rule.ActionsJson).map((action: { type: SimulatedAction }) => action.type)
    }))

    const result = simulateMessage({ seen: new Set(), lastMatched: new Map(conversation.lastMatched) }, rules, {
      tenantId: authority.tenantId,
      shopId,
      conversationId: conversation.id,
      messageId: message.messageId,
      text: message.text,
      nowMs: message.timestampMs
    })

    conversation.lastMatched = [...result.state.lastMatched]

    for (const trace of result.trace) {
      this.event(store, conversation.id, `rule_${trace.status}`, trace.ruleName, message.messageId)
    }

    for (const effect of result.effects) {
      this.event(store, conversation.id, effect.action, effect.text ?? effect.ruleName, message.messageId)

      if (
        effect.action === 'transfer_human' &&
        !store.tasks.some(task => task.conversationId === conversation.id && task.status === 'pending')
      ) {
        store.tasks.push({
          id: randomUUID(),
          conversationId: conversation.id,
          reason: effect.ruleName,
          status: 'pending',
          seen: false,
          createdAt: Date.now()
        })
        conversation.mode = 'pending'
        conversation.version++
      }
    }

    return false
  }

  private async perform(request: CustomerServiceRequest): Promise<CustomerServiceReply> {
    const fields: Record<string, string[]> = {
      snapshot: [],
      saveRule: ['expectedRevision', 'rule'],
      deleteRule: ['expectedRevision', 'ruleId'],
      simulate: ['expectedRevision', 'message'],
      seen: ['expectedRevision', 'taskId'],
      complete: ['expectedRevision', 'taskId'],
      resume: ['expectedRevision', 'conversationId', 'reason']
    }

    const allowed = fields[request?.action]

    if (
      !allowed ||
      !uuid(request.profileId) ||
      Object.keys(request).some(key => !['sessionId', 'profileId', 'action', ...allowed].includes(key))
    ) {
      fail('CUSTOMER_REQUEST_INVALID')
    }

    const authority = await this.authority(request.profileId)
    const file = path.join(this.deps.root, `${hash(authorityKey(authority))}.json`)
    const store = await this.read(file)
    let duplicate = false

    if (request.action !== 'snapshot') {
      if (request.expectedRevision !== store.revision) {
        fail('CUSTOMER_REVISION_CONFLICT')
      }

      switch (request.action) {
        case 'saveRule': {
          const existing = request.rule?.id ? store.rules.find(rule => rule.id === request.rule.id) : undefined

          if (request.rule?.id && !existing) {
            fail('CUSTOMER_RULE_NOT_FOUND')
          }

          const saved = nativeCustomerRule(request.rule!, existing?.id ?? randomUUID())

          if (existing) {
            store.rules[store.rules.indexOf(existing)] = saved
          } else {
            store.rules.push(saved)
          }

          break
        }

        case 'deleteRule': {
          if (!store.rules.some(rule => rule.id === request.ruleId)) {
            fail('CUSTOMER_RULE_NOT_FOUND')
          }

          store.rules = store.rules.filter(rule => rule.id !== request.ruleId)

          break
        }

        case 'simulate':
          duplicate = this.simulate(store, request, authority)

          break

        case 'seen':
        case 'complete': {
          const task = store.tasks.find(task => task.id === request.taskId)

          if (!task || task.status !== 'pending') {
            fail('CUSTOMER_TASK_CONFLICT')
          }

          const conversation = store.conversations.find(item => item.id === task.conversationId)!

          if (request.action === 'seen') {
            task.seen = true
          } else {
            task.status = 'completed'
            task.completedAt = Date.now()
            conversation.mode = 'waiting_resume'
            conversation.version++
          }

          this.event(store, task.conversationId, request.action, task.id)

          break
        }

        case 'resume': {
          if (!text(request.reason)) {
            fail('CUSTOMER_RESUME_REASON_REQUIRED')
          }

          const conversation = store.conversations.find(item => item.id === request.conversationId)

          if (
            !conversation ||
            conversation.mode !== 'waiting_resume' ||
            store.tasks.some(task => task.conversationId === conversation.id && task.status === 'pending')
          ) {
            fail('CUSTOMER_RESUME_CONFLICT')
          }

          conversation.mode = 'auto'
          conversation.version++
          this.event(store, conversation.id, 'resume_simulation', request.reason.trim())

          break
        }
      }

      if (!duplicate) {
        store.revision++
        await this.save(file, store, authority)
      }
    }

    const snapshot: CustomerServiceSnapshot = {
      revision: store.revision,
      profile: authority.profile,
      rules: store.rules,
      conversations: store.conversations,
      tasks: store.tasks,
      events: store.events.slice(-100).reverse()
    }

    this.assertCurrent()

    return { ok: true, snapshot, duplicate }
  }
}
