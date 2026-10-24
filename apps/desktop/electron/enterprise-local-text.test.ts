import crypto from 'node:crypto'
import { expect, it, vi } from 'vitest'

import { canonicalTextProofPayload, createEnterpriseTextAuthority, operateEnterpriseLocalText, type LocalTextDependencies } from './enterprise-local-text'
import type { LocalTextChoice, LocalTextRequest } from './enterprise-local-text-types'
import type { EnterpriseSession } from './enterprise-transport'

const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex')
const choice: LocalTextChoice = { backend_id: 'codex', configuration_id: 'b'.repeat(32), configuration_version: 1,
  model: 'gpt-6-luna', runtime_protocol: 'codex_responses', reasoning_effort: 'medium', availability: 'available' }
const submit: LocalTextRequest = { action: 'submit', sessionId: 'enterprise', conversationId: 'conversation',
  requestId: 'request', content: 'synthetic user text', choice }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {resolve = done})
  return { promise, resolve }
}

function harness(catalogSupported = true) {
  const session: EnterpriseSession = { authSource: 'password', baseUrl: 'https://business.invalid', sessionId: 'enterprise', token: 'private-enterprise-fixture' }
  let current = true
  let clock = 0
  let generation = 1
  let observed = { state: 'received', draft: 'private-raw-draft-canary' }
  const context = { owner_scope: 'a'.repeat(64), context_hash: 'c'.repeat(64), prompt_hash: sha('instructions'),
    prepared_at: 123, expires_in: 180, instructions: 'instructions', input: 'synthetic prepared text',
    model: 'gpt-6-luna', reasoning_effort: 'medium', runtime_protocol: 'codex_responses' }
  const client = {
    // Older lower-chain cases begin with a synthetic main-owned snapshot.
    // Preflight cases pass false and obtain it only through checkModel.
    connect: vi.fn(async () => {
      if (catalogSupported) {session.localText!.modelCheck = { status: 'supported', account: { registrationId: choice.configuration_id, generation } }}
    }), close: vi.fn(),
    request: vi.fn(async (method: string) => {
      if (method === 'enterprise_text.capabilities') {return { protocol_version: 2, runtime_id: 'd'.repeat(32), channel_id: 'e'.repeat(32) }}
      if (method === 'session.create') {return { session_id: 'enterprise-text-runtime-fixture' }}
      if (method === 'enterprise_text.submit' || method === 'enterprise_text.status') {return observed}
      if (method === 'enterprise_text.accept') {return { state: 'completed' }}
      if (method === 'enterprise_text.stop') {return { state: 'unknown', local_observation_stopped: true }}
      throw new Error('unexpected RPC')
    })
  }
  const deps: LocalTextDependencies = {
    proof: vi.fn(() => 'synthetic-request-proof'),
    assertCurrent: () => {if (!current) {throw new Error('LOCAL_TEXT_OWNER_CHANGED')}},
    now: () => clock,
    localConnection: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:1234', wsUrl: 'ws://127.0.0.1:1234/api/ws?token=fixture', mode: 'local', token: 'fixture' })),
    localApi: vi.fn(async (_connection, path) => {
      if (path.startsWith('/api/providers/siwc/status')) {return { state: 'ready', registration_id: choice.configuration_id, generation }}
      if (path.startsWith('/api/providers/siwc/models/check')) {return { model_status: 'supported', registration_id: choice.configuration_id, generation, model: 'gpt-6-luna', reasoning_effort: 'medium' }}
      if (path.includes('/start?')) {return { session_id: 'owned-login', auth_url: 'https://auth.openai.com/api/accounts/authorize?state=synthetic' }}
      if (path.includes('/poll/')) {return { status: 'pending' }}
      return { state: 'disconnected', ok: true }
    }),
    context: vi.fn(async body => ({ ...context, ...(body.action === 'accept' ? { text: 'safe summary' } : {}) })),
    createClient: () => client as unknown as ReturnType<NonNullable<LocalTextDependencies['createClient']>>
  }
  return { session, deps, client, context, ownerChanged: () => {current = false}, expire: () => {clock = 180001},
    accountChanged: () => {generation += 1}, setObserved: (value: typeof observed) => {observed = value},
    run: (payload: LocalTextRequest = submit) => operateEnterpriseLocalText(session, payload, deps),
    sends: () => client.request.mock.calls.filter(([method]) => method === 'enterprise_text.submit').length }
}

it('returns only the fresh S accepted text and a fixed owned choice', async () => {
  const h = harness()
  const result = await h.run()
  expect(result).toMatchObject({ state: 'completed', text: 'safe summary', backend_choice: choice })
  expect(JSON.stringify(result)).not.toContain('private-')
  expect(h.sends()).toBe(1)
  const actions = vi.mocked(h.deps.context).mock.calls.map(([body]) => body.action)
  expect(actions).toEqual(['status', 'prepare', 'revalidate', 'accept'])
})

it('queries the original unknown request without submitting again', async () => {
  const h = harness()
  h.setObserved({ state: 'unknown', draft: '' })
  expect((await h.run()).state).toBe('unknown')
  expect((await h.run({ ...submit, action: 'requestStatus', content: undefined })).state).toBe('unknown')
  h.setObserved({ state: 'received', draft: 'private-raw-draft-canary' })
  expect((await h.run({ ...submit, action: 'requestStatus' })).text).toBe('safe summary')
  expect(h.sends()).toBe(1)
})

it('a changed duplicate request cannot borrow the old response or send again', async () => {
  const h = harness()
  await h.run()
  const result = await h.run({ ...submit, content: 'different' })
  expect(result).toMatchObject({ state: 'unknown', reason: 'LOCAL_TEXT_REQUEST_CHANGED' })
  expect(h.sends()).toBe(1)
})

it('rejects renderer commands, paths and credentials before any I/O', async () => {
  for (const key of ['command', 'host', 'profile', 'credentials', 'cwd']) {
    const h = harness()
    expect((await h.run({ ...submit, [key]: 'forged' } as LocalTextRequest)).state).toBe('unavailable')
    expect(h.deps.context).not.toHaveBeenCalled()
    expect(h.sends()).toBe(0)
  }
})

it('does not route a local request to a remote descriptor', async () => {
  const h = harness()
  vi.mocked(h.deps.localConnection).mockResolvedValue({ mode: 'remote', baseUrl: 'https://remote.invalid', wsUrl: 'wss://remote.invalid/ws', token: 'foreign' })
  expect((await h.run()).reason).toBe('LOCAL_TEXT_LOCAL_RUNTIME_REQUIRED')
  expect(h.client.connect).not.toHaveBeenCalled()
  expect(h.sends()).toBe(0)
})

it('requires explicit new capability before text session.create on an older gateway', async () => {
  const h = harness()
  h.client.request.mockRejectedValue(new Error('unknown method'))
  expect((await h.run()).reason).toBe('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')
  expect(h.client.request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
  expect(h.client.close).toHaveBeenCalled()
})

it('revalidation rejection sends no model request', async () => {
  const h = harness()
  vi.mocked(h.deps.context).mockImplementation(async body => {
    if (body.action === 'revalidate') {throw new Error('private-authority-diagnostic')}
    return h.context
  })
  expect((await h.run()).state).toBe('unavailable')
  expect(h.sends()).toBe(0)
})

it('acceptance rejection never exposes the raw model draft', async () => {
  const h = harness()
  vi.mocked(h.deps.context).mockImplementation(async body => {
    if (body.action === 'accept') {throw new Error('private-authority-diagnostic')}
    return h.context
  })
  const result = await h.run()
  expect(result.state).toBe('unknown')
  expect(JSON.stringify(result)).not.toContain('private-')
  expect(h.sends()).toBe(1)
})

it('fences an owner switch and expiry after the model returned', async () => {
  for (const change of ['owner', 'expiry'] as const) {
    const h = harness()
    const original = h.client.request.getMockImplementation()!
    h.client.request.mockImplementation(async method => {
      const result = await original(method)
      if (method === 'enterprise_text.submit') {change === 'owner' ? h.ownerChanged() : h.expire()}
      return result
    })
    const result = await h.run()
    expect(result.state).toBe('unknown')
    expect(result.text).toBeUndefined()
    expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'accept')).toBe(false)
  }
})

it('fences an account-generation switch after the storage acknowledgement', async () => {
  const h = harness()
  const original = h.client.request.getMockImplementation()!
  h.client.request.mockImplementation(async method => {
    const result = await original(method)
    if (method === 'enterprise_text.accept') {h.accountChanged()}
    return result
  })
  expect(await h.run()).toMatchObject({ state: 'unknown', reason: 'LOCAL_TEXT_ACCOUNT_CHANGED' })
})

it('stop during prepare survives the await and prevents submission even if S is offline for stop', async () => {
  const h = harness()
  const entered = deferred<void>(), release = deferred<void>()
  vi.mocked(h.deps.context).mockImplementation(async body => {
    if (body.action === 'prepare') {entered.resolve(); await release.promise}
    return h.context
  })
  const running = h.run()
  await entered.promise
  const priorCalls = vi.mocked(h.deps.context).mock.calls.length
  expect((await h.run({ ...submit, action: 'stop' })).reason).toBe('LOCAL_TEXT_OBSERVATION_STOPPED')
  expect(vi.mocked(h.deps.context).mock.calls.length).toBe(priorCalls)
  release.resolve()
  expect((await running).state).toBe('unavailable')
  expect(h.sends()).toBe(0)
})

it('logout can end owned authorization without a reachable enterprise server', async () => {
  const h = harness()
  await h.run({ sessionId: 'enterprise', action: 'status' })
  vi.mocked(h.deps.context).mockRejectedValue(new Error('offline'))
  expect((await h.run({ sessionId: 'enterprise', action: 'logout' })).state).toBe('disconnected')
  expect(vi.mocked(h.deps.localApi).mock.calls.some(([, path]) => path.startsWith('/api/providers/siwc/logout?'))).toBe(true)
})

it('late login start after cancellation is cancelled and never returns an authorization URL', async () => {
  const h = harness()
  const entered = deferred<void>(), release = deferred<void>()
  const original = vi.mocked(h.deps.localApi).getMockImplementation()!
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
    if (args[1].includes('/start?')) {entered.resolve(); await release.promise}
    return original(...args)
  })
  const running = h.run({ sessionId: 'enterprise', action: 'connect' })
  await entered.promise
  await h.run({ sessionId: 'enterprise', action: 'cancelLogin' })
  release.resolve()
  expect(await running).toMatchObject({ state: 'unavailable', reason: 'LOCAL_TEXT_OWNER_CHANGED' })
  expect(vi.mocked(h.deps.localApi).mock.calls.some(([, path, , method]) => path.includes('/sessions/owned-login') && method === 'DELETE')).toBe(true)
})

it('waits for owned storage readiness before publishing ready or creating and submitting a conversation', async () => {
  const h = harness()
  const statusEntered = deferred<void>(), submitEntered = deferred<void>(), release = deferred<void>()
  const original = vi.mocked(h.deps.localApi).getMockImplementation()!
  let statusCalls = 0
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
    if (args[1].startsWith('/api/providers/siwc/status')) {
      statusCalls += 1
      if (statusCalls === 1) {statusEntered.resolve()}
      if (statusCalls === 2) {submitEntered.resolve()}
      await release.promise
    }
    return original(...args)
  })
  let statusReturned = false
  const checking = h.run({ sessionId: 'enterprise', action: 'status' }).then(result => {
    statusReturned = true
    return result
  })
  await statusEntered.promise
  const sending = h.run()
  await submitEntered.promise
  expect(statusReturned).toBe(false)
  expect(h.client.request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
  expect(h.sends()).toBe(0)
  expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'prepare')).toBe(false)
  release.resolve()
  expect(await checking).toMatchObject({ state: 'ready', choice })
  expect(await sending).toMatchObject({ state: 'completed', text: 'safe summary' })
  expect(h.sends()).toBe(1)
})

it('cannot publish a held readiness response after disposal, epoch change or owner change', async () => {
  for (const change of ['dispose', 'epoch', 'owner'] as const) {
    const h = harness()
    const entered = deferred<void>(), release = deferred<void>()
    const original = vi.mocked(h.deps.localApi).getMockImplementation()!
    vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
      if (args[1].startsWith('/api/providers/siwc/status')) {entered.resolve(); await release.promise}
      return original(...args)
    })
    const checking = h.run({ sessionId: 'enterprise', action: 'status' })
    await entered.promise
    if (change === 'dispose') {h.session.localText!.dispose()}
    if (change === 'epoch') {h.session.localTextEpoch = (h.session.localTextEpoch ?? 0) + 1}
    if (change === 'owner') {h.ownerChanged()}
    release.resolve()
    expect((await checking).state).not.toBe('ready')
    expect(h.client.request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
    expect(h.sends()).toBe(0)
    if (change === 'dispose') {expect(h.client.close).toHaveBeenCalled()}
  }
})

it('storage preparation failure cannot advertise ready or begin a conversation', async () => {
  const h = harness()
  vi.mocked(h.deps.localApi).mockResolvedValue({ state: 'unavailable', reason: 'SIWC_RECORD_UNAVAILABLE' })
  expect((await h.run({ sessionId: 'enterprise', action: 'status' })).state).toBe('unavailable')
  expect((await h.run()).state).toBe('unavailable')
  expect(h.client.request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
  expect(h.sends()).toBe(0)
  expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'prepare')).toBe(false)
})

const control = (action: LocalTextRequest['action']): LocalTextRequest => ({ sessionId: 'enterprise', action })
const catalogCalls = (h: ReturnType<typeof harness>) => vi.mocked(h.deps.localApi).mock.calls.filter(([, path]) => path.startsWith('/api/providers/siwc/models/check'))

it('model preflight keeps connected identity unverified and rejects a forged available submit without side effects', async () => {
  const h = harness(false)
  expect(await h.run(control('status'))).toMatchObject({ state: 'connected', modelStatus: 'unverified' })
  expect((await h.run(control('status'))).choice).toBeUndefined()
  expect(await h.run()).toMatchObject({ state: 'unavailable', reason: 'LOCAL_TEXT_MODEL_UNVERIFIED' })
  expect(catalogCalls(h)).toHaveLength(0)
  expect(h.sends()).toBe(0)
  expect(h.client.request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
  expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'prepare')).toBe(false)
  expect((await h.run({ ...control('checkModel'), modelStatus: 'supported' } as LocalTextRequest)).reason).toBe('LOCAL_TEXT_REQUEST_INVALID')
  expect(catalogCalls(h)).toHaveLength(0)
})

it('model preflight checks the main selected account once and never fetches during submit or accept', async () => {
  const h = harness(false)
  expect(await h.run(control('checkModel'))).toMatchObject({ state: 'ready', modelStatus: 'supported', choice })
  const calls = catalogCalls(h)
  expect(calls).toHaveLength(1)
  expect(calls[0][1]).toBe(`/api/providers/siwc/models/check?registration_id=${choice.configuration_id}&generation=1&profile=${h.session.localText!.profile}`)
  expect(calls[0][3]).toBe('POST')
  expect(await h.run()).toMatchObject({ state: 'completed', text: 'safe summary' })
  expect((await h.run(control('status'))).modelStatus).toBe('supported')
  expect(catalogCalls(h)).toHaveLength(1)
  expect(h.sends()).toBe(1)
})

it.each(['unsupported', 'unconfirmed', 'wrong-model', 'wrong-effort', 'wrong-generation', 'malformed', 'transport-error'])('model preflight %s cannot enable a new request and an explicit retry recovers', async kind => {
  const h = harness(false)
  const original = vi.mocked(h.deps.localApi).getMockImplementation()!
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
    const value = await original(...args)
    if (!args[1].startsWith('/api/providers/siwc/models/check')) {return value}
    if (kind === 'transport-error') {throw new Error('private upstream diagnostic canary')}
    return kind === 'malformed' ? { available: true } : { ...value,
      ...(kind === 'unsupported' || kind === 'unconfirmed' ? { model_status: kind } : {}),
      ...(kind === 'wrong-model' ? { model: 'other-model' } : {}),
      ...(kind === 'wrong-effort' ? { reasoning_effort: 'high' } : {}),
      ...(kind === 'wrong-generation' ? { generation: 2 } : {}) }
  })
  const result = await h.run(control('checkModel'))
  expect(result).toMatchObject({ state: 'connected', modelStatus: kind === 'unsupported' ? 'unsupported' : 'unconfirmed' })
  expect(result.choice).toBeUndefined()
  expect(JSON.stringify(result)).not.toContain('canary')
  expect((await h.run()).state).toBe('unavailable')
  expect(h.sends()).toBe(0)
  expect(h.client.request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
  vi.mocked(h.deps.localApi).mockImplementation(original)
  expect((await h.run(control('checkModel'))).modelStatus).toBe('supported')
  expect(catalogCalls(h)).toHaveLength(2)
})

it('model preflight reserves one check, revokes old support while waiting and completes without another GET', async () => {
  const h = harness(false)
  await h.run(control('checkModel'))
  const entered = deferred<void>(), release = deferred<void>()
  const original = vi.mocked(h.deps.localApi).getMockImplementation()!
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
    if (args[1].startsWith('/api/providers/siwc/models/check')) {entered.resolve(); await release.promise}
    return original(...args)
  })
  const running = h.run(control('checkModel'))
  await entered.promise
  expect(await h.run(control('checkModel'))).toMatchObject({ state: 'connected', modelStatus: 'checking' })
  expect((await h.run(control('status'))).choice).toBeUndefined()
  expect((await h.run()).state).toBe('unavailable')
  expect(catalogCalls(h)).toHaveLength(2)
  release.resolve()
  expect((await running).modelStatus).toBe('supported')
  expect((await h.run(control('status'))).modelStatus).toBe('supported')
  expect(catalogCalls(h)).toHaveLength(2)
})

it.each(['generation', 'logout', 'cancelLogin', 'connect', 'dispose', 'epoch', 'owner', 'runtime'])('model preflight discards held support after %s changes', async change => {
  const h = harness(false)
  const entered = deferred<void>(), release = deferred<void>()
  const original = vi.mocked(h.deps.localApi).getMockImplementation()!
  let failRuntime = false
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
    if (failRuntime) {throw new Error('LOCAL_TEXT_RUNTIME_UNAVAILABLE')}
    if (args[1].startsWith('/api/providers/siwc/models/check')) {entered.resolve(); await release.promise}
    return original(...args)
  })
  const running = h.run(control('checkModel'))
  await entered.promise
  if (change === 'generation') {h.accountChanged()}
  if (change === 'logout' || change === 'cancelLogin' || change === 'connect') {await h.run(control(change))}
  if (change === 'dispose') {h.session.localText!.dispose()}
  if (change === 'epoch') {h.session.localTextEpoch = (h.session.localTextEpoch ?? 0) + 1}
  if (change === 'owner') {h.ownerChanged()}
  if (change === 'runtime') {failRuntime = true}
  release.resolve()
  expect((await running).modelStatus).not.toBe('supported')
  expect(h.session.localText?.modelCheck?.status).not.toBe('supported')
  expect(h.sends()).toBe(0)
  expect(catalogCalls(h)).toHaveLength(1)
})

it('model preflight failure preserves same-request UNKNOWN query and accepted recovery without a second send', async () => {
  const h = harness(false)
  await h.run(control('checkModel'))
  h.setObserved({ state: 'unknown', draft: '' })
  expect((await h.run()).state).toBe('unknown')
  const original = vi.mocked(h.deps.localApi).getMockImplementation()!
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => args[1].startsWith('/api/providers/siwc/models/check')
    ? { model_status: 'unconfirmed', registration_id: choice.configuration_id, generation: 1, model: 'gpt-6-luna', reasoning_effort: 'medium' }
    : original(...args))
  expect((await h.run(control('checkModel'))).modelStatus).toBe('unconfirmed')
  expect((await h.run({ ...submit, action: 'requestStatus' })).state).toBe('unknown')
  h.setObserved({ state: 'received', draft: 'private draft' })
  expect(await h.run({ ...submit, action: 'requestStatus' })).toMatchObject({ state: 'completed', text: 'safe summary' })
  expect((await h.run({ ...submit, action: 'stop' })).state).toBe('unknown')
  expect(h.sends()).toBe(1)
  expect(catalogCalls(h)).toHaveLength(2)
})

it('model preflight final guard rejects a revoked snapshot after held revalidation without sending', async () => {
  const h = harness(false)
  await h.run(control('checkModel'))
  const entered = deferred<void>(), release = deferred<void>()
  const originalContext = vi.mocked(h.deps.context).getMockImplementation()!
  vi.mocked(h.deps.context).mockImplementation(async body => {
    if (body.action === 'revalidate') {entered.resolve(); await release.promise}
    return originalContext(body)
  })
  const sending = h.run()
  await entered.promise
  const originalApi = vi.mocked(h.deps.localApi).getMockImplementation()!
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
    const reply = await originalApi(...args)
    return args[1].startsWith('/api/providers/siwc/models/check') ? { ...reply, model_status: 'unconfirmed' } : reply
  })
  expect((await h.run(control('checkModel'))).modelStatus).toBe('unconfirmed')
  release.resolve()
  expect(await sending).toMatchObject({ state: 'unavailable', reason: 'LOCAL_TEXT_MODEL_UNVERIFIED' })
  expect(h.sends()).toBe(0)
  expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'accept')).toBe(false)
})

it.each(['success', 'failure'])('model preflight late check %s never reads identity or clears newer supported result', async outcome => {
  const h = harness(false)
  const entered = deferred<void>(), release = deferred<void>()
  const original = vi.mocked(h.deps.localApi).getMockImplementation()!
  let catalogs = 0, failStatus = false
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
    if (args[1].startsWith('/api/providers/siwc/status') && failStatus) {throw new Error('LOCAL_TEXT_RUNTIME_UNAVAILABLE')}
    if (args[1].startsWith('/api/providers/siwc/models/check') && ++catalogs === 1) {
      entered.resolve(); await release.promise
      if (outcome === 'failure') {throw new Error('private old error')}
    }
    return original(...args)
  })
  const first = h.run(control('checkModel'))
  await entered.promise
  failStatus = true
  expect((await h.run(control('status'))).state).toBe('unavailable')
  failStatus = false
  expect((await h.run(control('checkModel'))).modelStatus).toBe('supported')
  const before = vi.mocked(h.deps.localApi).mock.calls.filter(([, path]) => path.startsWith('/api/providers/siwc/status')).length
  failStatus = true
  release.resolve()
  expect((await first).modelStatus).not.toBe('supported')
  const after = vi.mocked(h.deps.localApi).mock.calls.filter(([, path]) => path.startsWith('/api/providers/siwc/status')).length
  expect(after).toBe(before)
  failStatus = false
  expect((await h.run(control('status'))).modelStatus).toBe('supported')
  expect(catalogCalls(h)).toHaveLength(2)
  expect(h.sends()).toBe(0)
})

it.each(['checkModel', 'connect'] as const)('model preflight entry revokes support before %s waits for enterprise status', async action => {
  const h = harness()
  await h.run(control('status'))
  const entered = deferred<void>(), release = deferred<void>()
  const original = vi.mocked(h.deps.context).getMockImplementation()!
  let hold = true
  vi.mocked(h.deps.context).mockImplementation(async body => {
    if (hold && body.action === 'status') {hold = false; entered.resolve(); await release.promise}
    return original(body)
  })
  const running = h.run(control(action))
  await entered.promise
  try {
    expect(await h.run()).toMatchObject({ state: 'unavailable' })
    expect((await h.run(control('status'))).choice).toBeUndefined()
    expect(h.sends()).toBe(0)
    expect(h.client.request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
    expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'prepare')).toBe(false)
  } finally {release.resolve(); await running}
  expect(catalogCalls(h)).toHaveLength(action === 'checkModel' ? 1 : 0)
})

it('model preflight entry failure clears its reservation and permits a later explicit retry', async () => {
  const h = harness()
  await h.run(control('status'))
  const original = vi.mocked(h.deps.context).getMockImplementation()!
  vi.mocked(h.deps.context).mockRejectedValueOnce(new Error('private enterprise diagnostic'))
  expect((await h.run(control('checkModel'))).state).toBe('unavailable')
  expect(h.session.localText!.modelCheck).toBeUndefined()
  expect(catalogCalls(h)).toHaveLength(0)
  vi.mocked(h.deps.context).mockImplementation(original)
  expect((await h.run(control('checkModel'))).modelStatus).toBe('supported')
  expect(catalogCalls(h)).toHaveLength(1)
})

it('model preflight entry coalesces concurrent checks while the first enterprise status is held', async () => {
  const h = harness()
  await h.run(control('status'))
  const entered = deferred<void>(), release = deferred<void>()
  const original = vi.mocked(h.deps.context).getMockImplementation()!
  let hold = true
  vi.mocked(h.deps.context).mockImplementation(async body => {
    if (hold && body.action === 'status') {hold = false; entered.resolve(); await release.promise}
    return original(body)
  })
  const first = h.run(control('checkModel'))
  await entered.promise
  expect((await h.run(control('checkModel'))).modelStatus).toBe('checking')
  expect(catalogCalls(h)).toHaveLength(0)
  release.resolve()
  expect((await first).modelStatus).toBe('supported')
  expect(catalogCalls(h)).toHaveLength(1)
})

const customerSubmit: LocalTextRequest = { ...submit, mode: 'knowledge_answer',
  customerId: '11111111-1111-1111-1111-111111111111', conversationId: '11111111-1111-1111-1111-111111111111',
  requestId: '22222222-2222-2222-2222-222222222222', workspaceRevision: 1,
  knowledgeQuery: 'synthetic knowledge question', replyPreferences: { tone: 'warm', length: 'balanced', address: 'nin' } }

function customerHarness() {
  const h = harness()
  const submitted = deferred<Record<string, unknown>>(), acknowledged = deferred<void>(), stopped = deferred<void>()
  const completed = deferred<{ state: string; draft?: string }>()
  const order: string[] = []
  const prepared = { ...h.context, input_hash: sha(h.context.input), expires_at: h.context.prepared_at + 180 }
  let handler: ((event: { type: string; session_id?: string; payload?: unknown }) => void) | undefined
  let lastSendRelease = true, ackLoss = false, forbidStatus = false
  let releaseHook: (() => Promise<void>) | undefined
  const original = h.client.request.getMockImplementation()!
  const client = { ...h.client,
    onEvent: vi.fn(listener => {handler = listener; return () => {handler = undefined}}),
    request: vi.fn(async (method: string, params: Record<string, unknown> = {}): Promise<any> => {
      order.push(`rpc:${method}`)
      if (method === 'enterprise_text.capabilities') {return { ...await original(method), last_send_release: lastSendRelease }}
      if (method === 'enterprise_text.submit') {submitted.resolve(params); return completed.promise}
      if (method === 'enterprise_text.release') {
        acknowledged.resolve()
        if (ackLoss) {completed.resolve({ state: 'unknown' }); throw new Error('private ACK loss')}
        completed.resolve({ state: 'received', draft: 'private-customer-raw-draft' })
        return { released: true, phase: 'draft' }
      }
      if (method === 'enterprise_text.stop') {stopped.resolve(); completed.resolve({ state: 'unknown' }); return { state: 'unknown' }}
      if (method === 'enterprise_text.status') {return { state: 'received', draft: 'private-customer-raw-draft' }}
      return original(method)
    }) }
  h.deps.createClient = () => client
  const originalApi = vi.mocked(h.deps.localApi).getMockImplementation()!
  vi.mocked(h.deps.localApi).mockImplementation(async (...args) => {
    if (args[1].startsWith('/api/providers/siwc/status')) {
      order.push('account')
      if (forbidStatus) {throw new Error('status after final S release')}
    }
    return originalApi(...args)
  })
  vi.mocked(h.deps.context).mockImplementation(async body => {
    order.push(`S:${body.action}`)
    if (body.action === 'release') {
      await releaseHook?.()
      return { ...prepared, instructions: undefined, input: undefined, phase_nonce: body.phase_nonce as string, phase: 'draft', single_use: true }
    }
    return prepared
  })
  const emit = (change: Record<string, unknown> = {}) => handler?.({ type: 'enterprise_text.release_required',
    session_id: 'enterprise-text-runtime-fixture', payload: { request_id: customerSubmit.requestId, nonce: 'f'.repeat(32),
      input_hash: prepared.input_hash, context_hash: prepared.context_hash, registration_id: choice.configuration_id,
      generation: choice.configuration_version, phase: 'draft', ...change } })
  return { ...h, client, submitted, acknowledged, stopped, prepared, order, emit,
    setReleaseHook: (hook: () => Promise<void>) => {releaseHook = hook},
    noCapability: () => {lastSendRelease = false}, loseAck: () => {ackLoss = true},
    completeUnknown: () => {completed.resolve({ state: 'unknown' })},
    forbidStatus: () => {forbidStatus = true}, allowStatus: () => {forbidStatus = false},
    sends: () => client.request.mock.calls.filter(([method]) => method === 'enterprise_text.submit').length,
    acks: () => client.request.mock.calls.filter(([method]) => method === 'enterprise_text.release').length }
}

it.each(['ordinary', 'shared'])('customer last-send %s uses original references, one phase and no post-release status or raw IPC result', async kind => {
  const h = customerHarness()
  const payload = kind === 'shared' ? { ...customerSubmit, workspaceRevision: undefined, customerOwnerId: 'synthetic-owner', conversationRevision: 7 } : customerSubmit
  h.setReleaseHook(async () => {h.forbidStatus()})
  const running = h.run(payload)
  const params = await h.submitted.promise
  expect(params).toMatchObject({ mode: 'knowledge_answer', input_hash: h.prepared.input_hash, context_hash: h.prepared.context_hash })
  const privateScope = sha(canonicalTextProofPayload({ root: customerSubmit.requestId, phase: 'draft', prompt_hash: h.prepared.prompt_hash }))
  expect(h.client.request.mock.calls.find(([method]) => method === 'session.create')![1]).toHaveProperty('conversation_id', privateScope)
  expect(privateScope).not.toBe(customerSubmit.customerId)
  h.emit(); h.emit()
  await h.acknowledged.promise
  const result = await running
  expect(result).toMatchObject({ state: 'unknown', reason: 'LOCAL_TEXT_CUSTOMER_ACCEPT_PENDING' })
  expect(JSON.stringify(result)).not.toContain('private-')
  expect(h.sends()).toBe(1); expect(h.acks()).toBe(1)
  const releaseAt = h.order.indexOf('S:release')
  expect(h.order.slice(releaseAt + 1)).not.toContain('account')
  const releaseBody = vi.mocked(h.deps.context).mock.calls.find(([body]) => body.action === 'release')![0]
  expect(releaseBody).toMatchObject({ mode: 'knowledge_answer', customer_id: customerSubmit.customerId,
    conversation_id: customerSubmit.customerId, request_id: customerSubmit.requestId, phase_nonce: 'f'.repeat(32),
    owned_binding: { registration_id: choice.configuration_id, generation: 1 } })
  expect(releaseBody.owned_binding).toHaveProperty('profile_scope', sha(h.session.localText!.profile))
  expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'accept')).toBe(false)
  h.allowStatus()
  expect((await h.run({ ...payload, action: 'requestStatus' })).text).toBeUndefined()
  expect((await h.run({ ...payload, workspaceRevision: kind === 'ordinary' ? 2 : undefined,
    conversationRevision: kind === 'shared' ? 8 : undefined })).reason).toBe('LOCAL_TEXT_REQUEST_CHANGED')
  expect(h.sends()).toBe(1)
})

it('customer last-send requires an advertised live event capability before prepare', async () => {
  const h = customerHarness(); h.noCapability()
  expect((await h.run(customerSubmit)).reason).toBe('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')
  expect(h.sends()).toBe(0)
  expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'prepare')).toBe(false)
})

it.each(['stop', 'logout', 'connect', 'dispose'] as const)('customer last-send %s while S release waits invalidates the phase without ACK', async ending => {
  const h = customerHarness(), entered = deferred<void>(), release = deferred<void>()
  h.setReleaseHook(async () => {entered.resolve(); await release.promise})
  const running = h.run(customerSubmit)
  await h.submitted.promise; h.emit(); await entered.promise
  if (ending === 'dispose') {h.session.localText!.dispose()}
  else {await h.run({ sessionId: 'enterprise', action: ending,
    ...(ending === 'stop' ? { conversationId: customerSubmit.conversationId, requestId: customerSubmit.requestId } : {}) })}
  release.resolve()
  await h.stopped.promise
  const result = await running
  expect(h.acks()).toBe(0)
  expect(result.text).toBeUndefined()
  h.emit()
  expect(h.acks()).toBe(0)
})

it('customer last-send S denial and lost ACK never expose draft or resend the original root', async () => {
  for (const failure of ['S', 'ACK']) {
    const h = customerHarness()
    if (failure === 'S') {h.setReleaseHook(async () => {throw new Error('private authority diagnostic')})}
    else {h.loseAck()}
    const running = h.run(customerSubmit)
    await h.submitted.promise; h.emit()
    await h.stopped.promise
    expect(JSON.stringify(await running)).not.toContain('private-')
    expect((await h.run(customerSubmit)).text).toBeUndefined()
    expect(h.sends()).toBe(1)
    expect(h.acks()).toBe(failure === 'S' ? 0 : 1)
  }
})

it('customer last-send rejects foreign phase fields before any S release or ACK', async () => {
  const h = customerHarness(), running = h.run(customerSubmit)
  await h.submitted.promise
  h.emit({ input_hash: '0'.repeat(64) })
  await h.stopped.promise
  expect((await running).text).toBeUndefined()
  expect(h.acks()).toBe(0)
  expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'release')).toBe(false)
})

it('customer last-send changed account at the final local status blocks S release', async () => {
  const h = customerHarness(), running = h.run(customerSubmit)
  await h.submitted.promise
  h.accountChanged(); h.emit()
  await h.stopped.promise
  expect((await running).text).toBeUndefined()
  expect(h.acks()).toBe(0)
  expect(vi.mocked(h.deps.context).mock.calls.some(([body]) => body.action === 'release')).toBe(false)
})

it('customer last-send owner loss also contains synchronous proof failure during cleanup', async () => {
  const h = customerHarness(), entered = deferred<void>(), release = deferred<void>(), attemptedStop = deferred<void>()
  h.setReleaseHook(async () => {entered.resolve(); await release.promise})
  const running = h.run(customerSubmit)
  await h.submitted.promise; h.emit(); await entered.promise
  h.ownerChanged()
  vi.mocked(h.deps.proof).mockImplementation(() => {attemptedStop.resolve(); throw new Error('LOCAL_TEXT_RUNTIME_UNAVAILABLE')})
  release.resolve()
  await attemptedStop.promise
  h.completeUnknown()
  expect((await running).text).toBeUndefined()
  expect(h.acks()).toBe(0)
})

it('customer last-send reserves a held prepare once and does not reset its deadline at the response', async () => {
  const h = customerHarness(), entered = deferred<void>(), release = deferred<void>()
  const original = vi.mocked(h.deps.context).getMockImplementation()!
  vi.mocked(h.deps.context).mockImplementation(async body => {
    if (body.action === 'prepare') {entered.resolve(); await release.promise}
    return original(body)
  })
  const first = h.run(customerSubmit)
  await entered.promise
  expect((await h.run(customerSubmit)).state).toBe('unknown')
  expect(vi.mocked(h.deps.context).mock.calls.filter(([body]) => body.action === 'prepare')).toHaveLength(1)
  h.expire(); release.resolve()
  expect((await first).state).toBe('unavailable')
  expect(h.sends()).toBe(0)
  expect(h.client.request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
})
