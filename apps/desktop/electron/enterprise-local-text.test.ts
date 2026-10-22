import crypto from 'node:crypto'
import { expect, it, vi } from 'vitest'

import { operateEnterpriseLocalText, type LocalTextDependencies } from './enterprise-local-text'
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

function harness() {
  const session: EnterpriseSession = { authSource: 'password', baseUrl: 'https://business.invalid', sessionId: 'enterprise', token: 'private-enterprise-fixture' }
  let current = true
  let clock = 0
  let generation = 1
  let observed = { state: 'received', draft: 'private-raw-draft-canary' }
  const context = { owner_scope: 'a'.repeat(64), context_hash: 'c'.repeat(64), prompt_hash: sha('instructions'),
    prepared_at: 123, expires_in: 180, instructions: 'instructions', input: 'synthetic prepared text',
    model: 'gpt-6-luna', reasoning_effort: 'medium', runtime_protocol: 'codex_responses' }
  const client = {
    connect: vi.fn(async () => undefined), close: vi.fn(),
    request: vi.fn(async (method: string) => {
      if (method === 'enterprise_text.capabilities') {return { protocol_version: 1 }}
      if (method === 'session.create') {return { session_id: 'enterprise-text-runtime-fixture' }}
      if (method === 'enterprise_text.submit' || method === 'enterprise_text.status') {return observed}
      if (method === 'enterprise_text.accept') {return { state: 'completed' }}
      if (method === 'enterprise_text.stop') {return { state: 'unknown', local_observation_stopped: true }}
      throw new Error('unexpected RPC')
    })
  }
  const deps: LocalTextDependencies = {
    assertCurrent: () => {if (!current) {throw new Error('LOCAL_TEXT_OWNER_CHANGED')}},
    now: () => clock,
    localConnection: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:1234', wsUrl: 'ws://127.0.0.1:1234/api/ws?token=fixture', mode: 'local', token: 'fixture' })),
    localApi: vi.fn(async (_connection, path) => {
      if (path.startsWith('/api/providers/siwc/status')) {return { state: 'ready', registration_id: choice.configuration_id, generation }}
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
