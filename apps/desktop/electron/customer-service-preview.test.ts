import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { CustomerServicePreview, nativeCustomerRule } from './customer-service-preview'
import type { CustomerRuleDraft, CustomerServiceRequest } from './customer-service-types'
import type { ShopBrowserProfile } from './shop-browser-types'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
const draft = (overrides: Partial<CustomerRuleDraft> = {}): CustomerRuleDraft => ({
  name: '人工处理',
  priority: 10,
  keywords: '人工',
  reply: '已为您登记人工处理',
  enabled: true,
  matchType: 'keyword_any',
  cooldownSeconds: 0,
  stopProcessing: true,
  doNotInvite: false,
  transferHuman: true,
  processEvaluatedClaim: false,
  ...overrides
})

async function fixture(existingRoot?: string) {
  const root = existingRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-customer-service-')))
  if (!existingRoot) roots.push(root)
  let current = true
  let allowed = true
  let profile: ShopBrowserProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: '测试店铺',
    tenantId: 'tenant-a',
    principalId: 'employee-a',
    shopId: '10001',
    shopName: '测试店铺',
    createdAt: new Date().toISOString(),
    checkedAt: null,
    loginState: 'unverified'
  }
  let origin = 'https://enterprise.example'
  let authorizations = 0
  let onAuthorize: (() => void) | undefined
  const controller = new CustomerServicePreview({
    root,
    isCurrent: () => current,
    async authorize(id) {
      authorizations++
      onAuthorize?.()
      if (!allowed || id !== profile.id) throw new Error('REVOKED')
      return { origin, tenantId: profile.tenantId, principalId: profile.principalId, profile: { ...profile } }
    }
  })
  const call = (action: CustomerServiceRequest['action'], rest: Partial<CustomerServiceRequest> = {}) =>
    controller.operate({ sessionId: 'test', profileId: profile.id, action, ...rest })
  const snapshot = async () => (await call('snapshot')).snapshot!
  const act = async (action: CustomerServiceRequest['action'], rest: Partial<CustomerServiceRequest> = {}) =>
    call(action, { expectedRevision: (await snapshot()).revision, ...rest })
  const message = (text = '人工', id: string = randomUUID(), conversationId = 'buyer-a', timestampMs = Date.now()) =>
    act('simulate', { message: { conversationId, messageId: id, text, timestampMs } })
  return {
    root,
    controller,
    call,
    snapshot,
    act,
    message,
    deny: () => {
      allowed = false
    },
    retire: () => {
      current = false
    },
    changeProfile: (value: Partial<ShopBrowserProfile>) => {
      profile = { ...profile, ...value }
    },
    changeOrigin: (value: string) => {
      origin = value
    },
    onAuthorize: (callback: () => void) => {
      onAuthorize = callback
    },
    authorizationCount: () => authorizations
  }
}

describe('native rule editor contract', () => {
  it('records the selected shop settings on a simulated claim and preserves historical snapshots', async () => {
    const f = await fixture()

    const settings = { remitAmount: '5', payoutReviewDays: 15, payoutRequireReviewWithinDays: true,
      payoutGoodReviewMode: 0 as const, payoutRefundChannel: 'small_remit' as const }

    f.changeProfile({ payoutSettings: settings })
    await f.act('saveRule', { rule: draft({ transferHuman: false, processEvaluatedClaim: true }) })
    const result = await f.message()

    expect(result.snapshot!.events.find(event => event.action === 'process_evaluated_claim')?.payoutSettings).toEqual(settings)
    f.changeProfile({ payoutSettings: { ...settings, payoutRefundChannel: 'refund_only' } })
    const next = await f.message()
    const claims = next.snapshot!.events.filter(event => event.action === 'process_evaluated_claim')

    expect(claims.map(event => event.payoutSettings?.payoutRefundChannel)).toEqual(['refund_only', 'small_remit'])
    expect(claims.every(event => event.payoutSettings?.remitAmount === '5')).toBe(true)
    const restored = await fixture(f.root)

    expect((await restored.snapshot()).events.filter(event => event.action === 'process_evaluated_claim')).toEqual(claims)
  })
  it('retains native fields, Int32 boundaries and optional empty keyword text', () => {
    const rule = nativeCustomerRule(
      draft({ name: '  规则  ', reply: '  回复  ', priority: 2147483647, cooldownSeconds: 2147483647, keywords: '  ' }),
      'rule'
    )
    expect(rule).toMatchObject({
      IntentName: '规则',
      ReplyText: '回复',
      Keywords: '',
      SortOrder: 2147483647,
      CooldownSeconds: 2147483647
    })
    for (const invalid of [{ priority: -1 }, { priority: 2147483648 }, { cooldownSeconds: 0.5 }, { reply: ' ' }]) {
      expect(() => nativeCustomerRule(draft(invalid), 'rule')).toThrow('CUSTOMER_RULE_INVALID')
    }
  })
  it('constructs the four action objects in the recovered editor order', () => {
    const rule = nativeCustomerRule(
      draft({ doNotInvite: true, transferHuman: true, processEvaluatedClaim: true }),
      'rule'
    )
    expect(JSON.parse(rule.ActionsJson)).toEqual([
      { type: 'send_message', template: '已为您登记人工处理' },
      { type: 'set_do_not_invite', value: true },
      { type: 'transfer_human' },
      { type: 'process_evaluated_claim' }
    ])
  })
})

describe('persistent local customer workflow', () => {
  it('returns only rule data to rule editing while preserving history and revision checks', async () => {
    const f = await fixture()
    await f.act('saveRule', { rule: draft() })
    const history = await f.message('人工', 'history-message', 'private-history')
    const revision = history.snapshot!.revision
    const storeFile = path.join(f.root, (await fs.readdir(f.root))[0])
    const beforeRead = await fs.readFile(storeFile, 'utf8')
    const rules = await f.call('rulesSnapshot')
    expect(rules.ok).toBe(true)
    expect(rules.snapshot).toBeUndefined()
    const ruleData = rules.rulesSnapshot!
    expect(Object.keys(ruleData).sort()).toEqual(['profile', 'revision', 'rules'])
    expect(ruleData.revision).toBe(revision)
    expect(JSON.stringify(rules)).not.toContain('private-history')
    expect(await fs.readFile(storeFile, 'utf8')).toBe(beforeRead)
    const update = await f.call('saveRule', {expectedRevision:revision, rule:draft({name:'changed'}), rulesOnly:true})
    expect(update.ok).toBe(true)
    expect(update.snapshot).toBeUndefined()
    expect(JSON.stringify(update)).not.toContain('private-history')
    expect((await f.snapshot()).conversations[0].id).toBe('private-history')
    const stale = await f.call('deleteRule', {expectedRevision:revision, ruleId:ruleData.rules[0].id, rulesOnly:true})
    expect(stale.error).toBe('CUSTOMER_REVISION_CONFLICT')
    const removed = await f.call('deleteRule', {expectedRevision:update.rulesSnapshot!.revision, ruleId:ruleData.rules[0].id, rulesOnly:true})
    expect(removed.ok).toBe(true)
    expect(removed.snapshot).toBeUndefined()
    expect(JSON.stringify(removed)).not.toContain('private-history')
    expect((await f.snapshot()).conversations[0].id).toBe('private-history')
    expect((await f.call('saveRule', {expectedRevision:0, rule:draft(), rulesOnly:false})).error).toBe('CUSTOMER_REQUEST_INVALID')
    f.deny()
    expect((await f.call('rulesSnapshot')).error).toBe('REVOKED')
    const retired = await fixture()
    retired.retire()
    expect((await retired.call('rulesSnapshot')).error).toBe('CUSTOMER_OWNER_CHANGED')
    const revokedWrite = await fixture()
    let checks = 0
    revokedWrite.onAuthorize(() => { if (++checks === 2) {revokedWrite.deny()} })
    expect((await revokedWrite.call('saveRule', {expectedRevision:0, rule:draft(), rulesOnly:true})).error).toBe('REVOKED')
    expect(await fs.readdir(revokedWrite.root)).toEqual([])
  })
  it('connects rule matching, human suppression, completion and explicit simulation recovery', async () => {
    const f = await fixture()
    await f.act('saveRule', { rule: draft() })
    await f.act('saveRule', { rule: draft({ name: '问候', keywords: '你好', reply: '您好', transferHuman: false }) })
    const triggered = await f.message()
    expect(triggered.snapshot!.tasks).toHaveLength(1)
    expect(triggered.snapshot!.conversations[0].mode).toBe('pending')
    const task = triggered.snapshot!.tasks[0]
    await f.act('seen', { taskId: task.id })
    const suppressed = await f.message('你好')
    expect(suppressed.snapshot!.events[0].action).toBe('suppressed')
    const complete = await f.act('complete', { taskId: task.id })
    expect(complete.snapshot!.conversations[0].mode).toBe('waiting_resume')
    expect((await f.message('你好')).snapshot!.events[0].action).toBe('suppressed')
    expect((await f.act('resume', { conversationId: 'buyer-a', reason: '' })).error).toBe(
      'CUSTOMER_RESUME_REASON_REQUIRED'
    )
    await f.act('resume', { conversationId: 'buyer-a', reason: '本地验收完成' })
    const resumed = await f.message('你好')
    expect(resumed.snapshot!.conversations[0].mode).toBe('auto')
    expect(resumed.snapshot!.events[0]).toMatchObject({ action: 'send_message', detail: '您好' })
  })

  it('restores rules, pending state, read markers and deduplication after controller restart', async () => {
    const f = await fixture()
    await f.act('saveRule', { rule: draft() })
    const first = await f.message('人工', 'stable-message')
    await f.act('seen', { taskId: first.snapshot!.tasks[0].id })
    const restarted = await fixture(f.root)
    const state = await restarted.snapshot()
    expect(state.rules).toHaveLength(1)
    expect(state.tasks[0].seen).toBe(true)
    expect(state.conversations[0].mode).toBe('pending')
    const duplicate = await restarted.message('人工', 'stable-message')
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.snapshot!.revision).toBe(state.revision)
    expect(duplicate.snapshot!.tasks).toHaveLength(1)
    expect((await restarted.message('人工', 'stable-message', 'another-buyer')).error).toBe('CUSTOMER_MESSAGE_CONFLICT')
  })

  it('rejects missing timestamps without consuming the message identity', async () => {
    const f = await fixture()
    await f.act('saveRule', { rule: draft() })
    for (const timestamp of [NaN, 0, Infinity]) {
      expect((await f.message('人工', 'retry-message', 'buyer-a', timestamp)).error).toBe('CUSTOMER_TIMESTAMP_REQUIRED')
    }
    expect((await f.snapshot()).tasks).toEqual([])
    expect((await f.message('人工', 'retry-message')).snapshot!.tasks).toHaveLength(1)
  })

  it('isolates server, enterprise, employee, profile and changed shop bindings', async () => {
    const f = await fixture()
    await f.act('saveRule', { rule: draft() })
    for (const change of [
      () => f.changeOrigin('https://other.example'),
      () => f.changeProfile({ tenantId: 'tenant-b' }),
      () => f.changeProfile({ principalId: 'employee-b' }),
      () => f.changeProfile({ id: randomUUID() }),
      () => f.changeProfile({ shopId: '20002' })
    ]) {
      change()
      expect((await f.snapshot()).rules).toEqual([])
    }
    const another = await fixture(f.root)
    expect((await another.snapshot()).rules).toHaveLength(1)
  })

  it('refuses revoked access, stale sessions and foreign profiles', async () => {
    const f = await fixture()
    expect((await f.call('snapshot', { profileId: randomUUID() })).error).toBe('REVOKED')
    f.deny()
    expect((await f.call('snapshot')).error).toBe('REVOKED')
    f.retire()
    expect((await f.call('snapshot')).error).toBe('CUSTOMER_OWNER_CHANGED')
  })

  it('rechecks authorization before committing a write', async () => {
    const f = await fixture()
    const before = f.authorizationCount()
    f.onAuthorize(() => {
      if (f.authorizationCount() === before + 2) f.deny()
    })
    expect((await f.call('saveRule', { expectedRevision: 0, rule: draft() })).error).toBe('REVOKED')
    expect((await (await fixture(f.root)).snapshot()).rules).toEqual([])
  })

  it('rejects changed shop identity while a transaction is being authorized', async () => {
    const f = await fixture()
    const before = f.authorizationCount()
    f.onAuthorize(() => {
      if (f.authorizationCount() === before + 2) f.changeProfile({ shopId: '20002' })
    })
    expect((await f.call('saveRule', { expectedRevision: 0, rule: draft() })).error).toBe('CUSTOMER_OWNER_CHANGED')
    expect((await (await fixture(f.root)).snapshot()).rules).toEqual([])
  })

  it('serializes concurrent controllers and rejects stale revisions', async () => {
    const f = await fixture()
    const second = await fixture(f.root)
    const replies = await Promise.all([
      f.call('saveRule', { expectedRevision: 0, rule: draft() }),
      second.call('saveRule', { expectedRevision: 0, rule: draft({ name: '第二条' }) })
    ])
    expect(replies.filter(reply => reply.ok)).toHaveLength(1)
    expect(replies.filter(reply => reply.error === 'CUSTOMER_REVISION_CONFLICT')).toHaveLength(1)
    expect((await f.snapshot()).rules).toHaveLength(1)
  })

  it('records evaluated-claim as a local simulated action and never advances a payment state', async () => {
    const f = await fixture()
    await f.act('saveRule', { rule: draft({ processEvaluatedClaim: true, transferHuman: false }) })
    const result = await f.message()
    expect(result.snapshot!.events[0].action).toBe('process_evaluated_claim')
    expect(result.snapshot!.tasks).toEqual([])
    expect(result.snapshot!.conversations[0].mode).toBe('auto')
  })

  it('updates and deletes a rule through the same persisted entry point', async () => {
    const f = await fixture()
    const first = await f.act('saveRule', { rule: draft() })
    const id = first.snapshot!.rules[0].id
    await f.act('saveRule', { rule: draft({ id, reply: '修改后的回复' }) })
    expect((await f.snapshot()).rules[0].ReplyText).toBe('修改后的回复')
    await f.act('deleteRule', { ruleId: id })
    expect((await (await fixture(f.root)).snapshot()).rules).toEqual([])
  })
})
