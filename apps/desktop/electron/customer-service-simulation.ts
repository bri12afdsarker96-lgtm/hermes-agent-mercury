/** Reused offline simulator. Matching, ordering and cooldown scope are Hermes
 * simulation policy. The recovered native client contains no message executor. */
export type RuleMatchType = 'keyword_any' | 'exact_match'
export type SimulatedAction = 'send_message' | 'set_do_not_invite' | 'transfer_human' | 'process_evaluated_claim'

export interface ReplyRule {
  id: string
  order: number
  tenantId: string
  shopId: string
  name: string
  priority: number
  enabled: boolean
  matchType: RuleMatchType
  keywords: string[]
  reply: string
  cooldownSeconds: number
  stopProcessing: boolean
  actions: SimulatedAction[]
}

export interface SimulatedMessage {
  tenantId: string
  shopId: string
  conversationId: string
  messageId: string
  text: string
  nowMs: number
}

export interface SimulatedEffect {
  ruleId: string
  ruleName: string
  action: SimulatedAction
  text?: string
}

export interface RuleTrace {
  ruleId: string
  ruleName: string
  status: 'matched' | 'cooldown' | 'not_matched' | 'disabled'
}

export interface SimulationState {
  seen: ReadonlySet<string>
  lastMatched: ReadonlyMap<string, number>
}

export interface SimulationResult {
  duplicate: boolean
  effects: SimulatedEffect[]
  trace: RuleTrace[]
  state: SimulationState
}

const validActions: ReadonlySet<string> = new Set([
  'send_message',
  'set_do_not_invite',
  'transfer_human',
  'process_evaluated_claim'
])

export function validateRule(rule: ReplyRule): string | null {
  if (!rule.id.trim() || !rule.name.trim()) {
    return '请填写规则名称。'
  }

  if (!rule.tenantId.trim() || !rule.shopId.trim()) {
    return '请填写规则适用的模拟企业和店铺。'
  }

  if (
    !Number.isSafeInteger(rule.order) ||
    rule.order < 0 ||
    !Number.isInteger(rule.priority) ||
    rule.priority < 0 ||
    rule.priority > 2147483647
  ) {
    return '优先级必须是非负整数。'
  }

  if (!Number.isInteger(rule.cooldownSeconds) || rule.cooldownSeconds < 0 || rule.cooldownSeconds > 2147483647) {
    return '冷却时间必须是非负 Int32 整数秒。'
  }

  if (rule.matchType !== 'keyword_any' && rule.matchType !== 'exact_match') {
    return '请选择有效的匹配方式。'
  }

  if (rule.keywords.some(word => !word.trim())) {
    return '关键词格式无效。'
  }

  if (!rule.reply.trim()) {
    return '请填写回复内容。'
  }

  if (
    !rule.actions.length ||
    rule.actions.some(action => !validActions.has(action)) ||
    new Set(rule.actions).size !== rule.actions.length
  ) {
    return '请选择有效且不重复的动作。'
  }

  return null
}

export function emptySimulationState(): SimulationState {
  return { seen: new Set(), lastMatched: new Map() }
}

function normalize(text: string): string {
  return text.trim().toLowerCase()
}

/** Stable platform identities are necessary for production deduplication; these are synthetic only. */
export function simulateMessage(
  state: SimulationState,
  rules: readonly ReplyRule[],
  message: SimulatedMessage
): SimulationResult {
  const { tenantId, shopId, conversationId, messageId, text, nowMs } = message

  if (![tenantId, shopId, conversationId, messageId, text].every(value => value.trim()) || !Number.isFinite(nowMs)) {
    throw new Error('请填写模拟企业、店铺、会话、消息编号和消息内容。')
  }

  const messageKey = JSON.stringify([tenantId.trim(), shopId.trim(), messageId.trim()])

  if (state.seen.has(messageKey)) {
    return { duplicate: true, effects: [], trace: [], state }
  }

  const seen = new Set(state.seen)
  const lastMatched = new Map(state.lastMatched)
  const effects: SimulatedEffect[] = []
  const trace: RuleTrace[] = []
  seen.add(messageKey)

  const scopedRules = rules.filter(
    rule => rule.tenantId.trim() === tenantId.trim() && rule.shopId.trim() === shopId.trim()
  )

  for (const rule of scopedRules.sort((a, b) => b.priority - a.priority || a.order - b.order)) {
    const addTrace = (status: RuleTrace['status']) => trace.push({ ruleId: rule.id, ruleName: rule.name, status })

    if (!rule.enabled) {
      addTrace('disabled')

      continue
    }

    if (validateRule(rule)) {
      throw new Error(`规则“${rule.name}”配置无效，请检查后重试。`)
    }

    const content = normalize(text)

    const matched = rule.keywords.some(word =>
      rule.matchType === 'exact_match' ? content === normalize(word) : content.includes(normalize(word))
    )

    if (!matched) {
      addTrace('not_matched')

      continue
    }

    const cooldownKey = JSON.stringify([tenantId.trim(), shopId.trim(), conversationId.trim(), rule.id])
    const last = lastMatched.get(cooldownKey)

    if (last !== undefined && nowMs - last < rule.cooldownSeconds * 1000) {
      addTrace('cooldown')

      continue
    }

    lastMatched.set(cooldownKey, nowMs)
    addTrace('matched')

    for (const action of rule.actions) {
      effects.push({
        ruleId: rule.id,
        ruleName: rule.name,
        action,
        ...(action === 'send_message' ? { text: rule.reply.trim() } : {})
      })
    }

    if (rule.stopProcessing) {
      break
    }
  }

  return { duplicate: false, effects, trace, state: { seen, lastMatched } }
}
