import crypto from 'node:crypto'

import { JsonRpcGatewayClient } from '../../shared/src/json-rpc-gateway'

import type { EnterpriseSession } from './enterprise-transport'
import type { LocalTextChoice, LocalTextRequest, LocalTextReply } from './enterprise-local-text-types'
export type { LocalTextRequest } from './enterprise-local-text-types'

interface Context {
  owner_scope: string
  context_hash: string
  prompt_hash: string
  prepared_at: number
  expires_in: number
  instructions: string
  input: string
  model: string
  reasoning_effort: string
  runtime_protocol: string
  answer?: string
  text?: string
}

interface Pending {
  conversationId: string
  requestId: string
  content: string
  contentHash: string
  personaId?: string
  prepared: Context
  deadline: number
  choice: LocalTextChoice
  gatewaySessionId: string
  stopped: boolean
  attempted: boolean
  inFlight?: boolean
  completed?: LocalTextReply
  accepted?: LocalTextReply
}

export interface LocalTextDependencies {
  assertCurrent(): void
  context(body: Record<string, unknown>): Promise<Context>
  localConnection(): Promise<{ baseUrl: string; wsUrl: string; token: string; mode?: string; source?: string }>
  localApi(connection: { baseUrl: string; token: string }, path: string, owner: string, method: string): Promise<any>
  proof(connection: { baseUrl: string; token: string }, operation: string, payload: unknown, channel: string, runtimeId?: string): string
  now?(): number
  createClient?(): Pick<JsonRpcGatewayClient, 'connect' | 'request' | 'close'>
}

export interface EnterpriseLocalTextState {
  ownerScope: string
  profile: string
  owner: string
  closed: boolean
  epoch: number
  loginId?: string
  loginStarting: boolean
  requests: Record<string, Pending>
  conversations: Record<string, { id: string; binding: string }>
  init: Promise<void>
  client: Pick<JsonRpcGatewayClient, 'connect' | 'request' | 'close'>
  request<T = any>(method: string, params: Record<string, unknown>, timeout?: number): Promise<T>
  api(path: string, method?: string): Promise<any>
  dispose(): void
}

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex')
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value)
const finite = (reason: string) => new Error(reason)

export function canonicalTextProofPayload(value: unknown): string {
  const visit = (item: unknown, depth = 0): string => {
    if (depth > 16) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
    if (item === null || typeof item === 'boolean') {return JSON.stringify(item)}
    if (typeof item === 'number' && Number.isSafeInteger(item)) {return JSON.stringify(item)}
    if (typeof item === 'string') {
      if (Buffer.from(item, 'utf8').toString('utf8') !== item) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
      return JSON.stringify(item)
    }
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
      for (let index = 0; index < item.length; index += 1) {
        if (!Object.hasOwn(item, index)) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
      }
      return `[${item.map(child => visit(child, depth + 1)).join(',')}]`
    }
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return `{${Object.keys(item).sort().map(key => {
        if (!/^[A-Za-z0-9_]+$/.test(key)) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
        return `${JSON.stringify(key)}:${visit((item as Record<string, unknown>)[key], depth + 1)}`
      }).join(',')}}`
    }
    throw finite('LOCAL_TEXT_REQUEST_INVALID')
  }
  const encoded = visit(value)
  if (Buffer.byteLength(encoded, 'utf8') > 262144) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
  return encoded
}

/** One spawned runtime's private closure, never a renderer descriptor. */
export function createEnterpriseTextAuthority(backend: { kind?: string; shell?: boolean; args?: string[] }, isCurrent: () => boolean, clock = Date.now) {
  if (backend.kind !== 'python' || backend.shell !== false || backend.args?.[0] !== '-m' || backend.args[1] !== 'hermes_cli.main') {return null}
  const key = crypto.randomBytes(32)
  const runtimeId = crypto.randomBytes(16).toString('hex')
  let endpoint: { baseUrl: string; token: string } | undefined
  return {
    bootstrapEnv: () => ({ HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY: key.toString('hex'), HERMES_ENTERPRISE_TEXT_RUNTIME_ID: runtimeId }),
    bind(connection: { baseUrl: string; token: string }) {
      if (endpoint || !isCurrent()) {throw finite('LOCAL_TEXT_RUNTIME_UNAVAILABLE')}
      endpoint = { baseUrl: connection.baseUrl, token: connection.token }
    },
    prove(connection: { baseUrl: string; token: string }, operation: string, payload: unknown, channel: string, claimedRuntime = runtimeId) {
      if (!endpoint || !isCurrent() || endpoint.baseUrl !== connection.baseUrl || endpoint.token !== connection.token ||
          claimedRuntime !== runtimeId || !/^(?:[a-f0-9]{32}|http)$/.test(channel)) {throw finite('LOCAL_TEXT_RUNTIME_UNAVAILABLE')}
      const issued = String(clock())
      const nonce = crypto.randomBytes(16).toString('hex')
      const bodyHash = hash(canonicalTextProofPayload(payload))
      const fields = ['v1', runtimeId, issued, nonce, channel]
      const mac = crypto.createHmac('sha256', key).update([...fields, operation, bodyHash].join('\n')).digest('hex')
      return [...fields, mac].join('.')
    }
  }
}

function assertPayload(payload: LocalTextRequest) {
  const allowed = new Set(['sessionId', 'action', 'conversationId', 'requestId', 'content', 'personaId', 'choice'])
  if (!payload || Object.keys(payload).some(key => !allowed.has(key)) ||
      !['status', 'connect', 'cancelLogin', 'logout', 'submit', 'requestStatus', 'stop'].includes(payload.action)) {
    throw finite('LOCAL_TEXT_REQUEST_INVALID')
  }
}

async function binding(session: EnterpriseSession, deps: LocalTextDependencies, ownerScope: string) {
  if (!/^[a-f0-9]{64}$/.test(ownerScope)) {throw finite('LOCAL_TEXT_AUTHORITY_UNAVAILABLE')}
  if (session.localText?.ownerScope !== ownerScope) {
    session.localText?.dispose()
    session.localText = undefined
  }
  if (!session.localText) {
    const owner = crypto.randomBytes(32).toString('hex')
    const profile = `enterprise-text-${hash(`${new URL(session.baseUrl).origin}:${ownerScope}`).slice(0, 32)}`
    const client = deps.createClient?.() ?? new JsonRpcGatewayClient({ requestTimeoutMs: 100_000 })
    let connection: Awaited<ReturnType<LocalTextDependencies['localConnection']>>
    let channel = ''
    let runtimeId = ''
    const state: EnterpriseLocalTextState = {
      ownerScope, profile, owner, closed: false, epoch: 0, loginStarting: false, requests: Object.create(null), conversations: Object.create(null), client,
      init: Promise.resolve(),
      request<T>(method: string, params: Record<string, unknown>, timeout?: number): Promise<T> {
        const proof = deps.proof(connection, `rpc:${method}`, params, channel, runtimeId)
        return client.request<T>(method, { ...params, _main_proof: proof }, timeout)
      },
      async api(path, method = 'GET') {
        if (!connection) {throw finite('LOCAL_TEXT_RUNTIME_UNAVAILABLE')}
        return deps.localApi(connection, `${path}${path.includes('?') ? '&' : '?'}profile=${profile}`, owner, method)
      },
      dispose() {
        if (state.closed) {return}
        state.closed = true
        state.epoch += 1
        const cleanup: Promise<unknown>[] = []
        if (state.loginId) {
          cleanup.push(state.api(`/api/providers/oauth/sessions/${state.loginId}`, 'DELETE').catch(() => undefined))
        }
        for (const pending of Object.values(state.requests)) {
          pending.stopped = true
          if (pending.attempted && !pending.completed) {
          cleanup.push(state.request('enterprise_text.stop', { owner, session_id: pending.gatewaySessionId, request_id: pending.requestId }, 5000).catch(() => undefined))
          }
        }
        void Promise.allSettled(cleanup).finally(() => client.close())
        state.requests = Object.create(null)
      }
    }
    session.localText = state
    state.init = (async () => {
      connection = await deps.localConnection()
      deps.assertCurrent()
      if (state.closed) {throw finite('LOCAL_TEXT_OWNER_CHANGED')}
      const base = new URL(connection.baseUrl)
      const ws = new URL(connection.wsUrl)
      if ((connection.mode !== 'local' && connection.source !== 'local') || base.protocol !== 'http:' ||
          base.hostname !== '127.0.0.1' || ws.hostname !== base.hostname || ws.port !== base.port || ws.protocol !== 'ws:') {
        throw finite('LOCAL_TEXT_LOCAL_RUNTIME_REQUIRED')
      }
      await client.connect(connection.wsUrl)
      deps.assertCurrent()
      if (state.closed) {throw finite('LOCAL_TEXT_OWNER_CHANGED')}
      const capabilities = await client.request<{ protocol_version: number; runtime_id: string; channel_id: string }>('enterprise_text.capabilities', {}, 5000)
        .catch(() => {throw finite('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')})
      if (capabilities.protocol_version !== 2 || !/^[a-f0-9]{32}$/.test(capabilities.runtime_id) || !/^[a-f0-9]{32}$/.test(capabilities.channel_id)) {throw finite('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')}
      runtimeId = capabilities.runtime_id
      channel = capabilities.channel_id
      // Match public challenge to the actual private spawned runtime before
      // any account lookup. This unused proof has no backend side effects.
      deps.proof(connection, 'rpc:enterprise_text.capabilities', {}, channel, runtimeId)
    })().catch(error => {
      state.dispose()
      client.close()
      if (session.localText === state) {session.localText = undefined}
      throw error
    })
  }
  const state = session.localText
  await state.init
  deps.assertCurrent()
  if (state.closed || session.localText !== state) {throw finite('LOCAL_TEXT_OWNER_CHANGED')}
  return state
}

function choiceFrom(status: any): LocalTextChoice {
  if (status.state !== 'ready' || !/^[a-f0-9]{32}$/.test(status.registration_id) || !Number.isSafeInteger(status.generation) || status.generation < 0) {
    throw finite('LOCAL_TEXT_CONNECT_REQUIRED')
  }
  return { backend_id: 'codex', configuration_id: status.registration_id, configuration_version: status.generation,
    model: 'gpt-6-luna', reasoning_effort: 'medium', runtime_protocol: 'codex_responses', availability: 'available' }
}

function sameChoice(left: LocalTextChoice, right: LocalTextChoice) {
  return Object.keys(right).every(key => left[key as keyof LocalTextChoice] === right[key as keyof LocalTextChoice])
}

export async function operateEnterpriseLocalText(session: EnterpriseSession, payload: LocalTextRequest, deps: LocalTextDependencies): Promise<LocalTextReply> {
  let pending: Pending | undefined
  try {
    assertPayload(payload)
    deps.assertCurrent()
    const operationEpoch = session.localTextEpoch ?? 0
    const assertOperation = () => {
      deps.assertCurrent()
      if ((session.localTextEpoch ?? 0) !== operationEpoch) {throw finite('LOCAL_TEXT_OWNER_CHANGED')}
    }
    // Ending one's own local work needs no new enterprise data permission or
    // reachable business server. Remember stop even while prepare/init awaits.
    if (payload.action === 'stop') {
      if (!id(payload.requestId) || !id(payload.conversationId)) {throw finite('LOCAL_TEXT_ASSOCIATION_INVALID')}
      const state = session.localText
      const request = state?.requests[payload.requestId]
      if (request && request.conversationId !== payload.conversationId) {throw finite('LOCAL_TEXT_ASSOCIATION_INVALID')}
      session.localTextStops ??= new Set()
      if (session.localTextStops.size >= 128) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
      session.localTextStops.add(payload.requestId)
      if (request) {
        request.stopped = true
        if (request.attempted) {
          await state!.request('enterprise_text.stop', { owner: state!.owner, session_id: request.gatewaySessionId, request_id: request.requestId }, 5000)
        }
      }
      deps.assertCurrent()
      return { state: 'unknown', reason: 'LOCAL_TEXT_OBSERVATION_STOPPED', requestId: payload.requestId }
    }
    if (payload.action === 'cancelLogin' || payload.action === 'logout') {
      session.localTextEpoch = operationEpoch + 1
      const state = session.localText
      if (!state) {return { state: 'disconnected' }}
      state.epoch += 1
      if (state.loginId) {
        await state.api(`/api/providers/oauth/sessions/${state.loginId}`, 'DELETE')
        state.loginId = undefined
      }
      if (payload.action === 'logout') {
        for (const request of Object.values(state.requests)) {
          request.stopped = true
          if (request.attempted && !request.completed) {
            void state.request('enterprise_text.stop', { session_id: request.gatewaySessionId, owner: state.owner, request_id: request.requestId }, 5000).catch(() => undefined)
          }
        }
        await state.api('/api/providers/siwc/logout', 'POST')
      }
      deps.assertCurrent()
      return { state: 'disconnected' }
    }
    const authority = await deps.context({ action: 'status' })
    assertOperation()
    const state = await binding(session, deps, authority.owner_scope)
    assertOperation()
    const epoch = state.epoch
    const now = deps.now ?? (() => performance.now())
    const current = () => {
      assertOperation()
      if (state.closed || session.localText !== state || state.epoch !== epoch) {throw finite('LOCAL_TEXT_OWNER_CHANGED')}
    }
    const account = async () => {
      const status = await state.api('/api/providers/siwc/status')
      current()
      return choiceFrom(status)
    }
    if (payload.action === 'status') {
      if (state.loginStarting) {return { state: 'connecting' }}
      if (state.loginId) {
        const login = await state.api(`/api/providers/oauth/openai-siwc/poll/${state.loginId}`)
        current()
        if (login.status === 'pending') {return { state: 'connecting' }}
        state.loginId = undefined
        if (login.status !== 'approved') {return { state: 'disconnected', reason: 'LOCAL_TEXT_LOGIN_UNCONFIRMED' }}
      }
      try {return { state: 'ready', choice: await account() }}
      catch {return { state: 'disconnected', reason: 'LOCAL_TEXT_CONNECT_REQUIRED' }}
    }
    if (payload.action === 'connect') {
      if (state.loginStarting || state.loginId) {return { state: 'connecting' }}
      if (Object.values(state.requests).some(item => item.inFlight)) {throw finite('LOCAL_TEXT_RESULT_UNKNOWN')}
      state.loginStarting = true
      try {
        const login = await state.api('/api/providers/oauth/openai-siwc/start', 'POST')
        state.loginId = login.session_id
        try {current()} catch {
          await state.api(`/api/providers/oauth/sessions/${state.loginId}`, 'DELETE').catch(() => undefined)
          throw finite('LOCAL_TEXT_OWNER_CHANGED')
        }
        const url = new URL(login.auth_url)
        if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize' ||
            url.searchParams.has('id_token_hint') || !id(login.session_id)) {throw finite('LOCAL_TEXT_LOGIN_UNAVAILABLE')}
        return { state: 'connecting', authUrl: url.href }
      } finally {state.loginStarting = false}
    }
    if (!id(payload.requestId) || !id(payload.conversationId)) {throw finite('LOCAL_TEXT_ASSOCIATION_INVALID')}
    const requestId = payload.requestId
    pending = state.requests[requestId]
    if (pending && pending.conversationId !== payload.conversationId) {throw finite('LOCAL_TEXT_ASSOCIATION_INVALID')}
    if (pending && payload.action === 'submit' && (typeof payload.content !== 'string' || hash(payload.content) !== pending.contentHash ||
        payload.personaId !== pending.personaId || !payload.choice || !sameChoice(payload.choice, pending.choice))) {
      throw finite('LOCAL_TEXT_REQUEST_CHANGED')
    }
    const selected = await account()
    current()
    if (payload.action === 'submit' && !pending) {
      if (session.localTextStops?.has(requestId)) {throw finite('LOCAL_TEXT_OBSERVATION_STOPPED')}
      if (!payload.choice || !sameChoice(payload.choice, selected) || typeof payload.content !== 'string' ||
          !payload.content.trim() || payload.content.length > 24000 ||
          Object.values(state.requests).some(item => item.inFlight || item.conversationId === payload.conversationId && item.attempted && !item.completed) || Object.keys(state.requests).length >= 128) {
        throw finite('LOCAL_TEXT_REQUEST_INVALID')
      }
      const content = payload.content
      const prepared = await deps.context({ action: 'prepare', mode: 'summarize', content, persona_id: payload.personaId,
        conversation_id: payload.conversationId, request_id: requestId })
      current()
      if (prepared.owner_scope !== state.ownerScope || prepared.model !== selected.model ||
          prepared.reasoning_effort !== selected.reasoning_effort || prepared.runtime_protocol !== selected.runtime_protocol ||
          typeof prepared.instructions !== 'string' || hash(prepared.instructions) !== prepared.prompt_hash ||
          typeof prepared.input !== 'string' || !/^[a-f0-9]{64}$/.test(prepared.context_hash) ||
          !(prepared.expires_in > 0 && prepared.expires_in <= 180)) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
      const key = `${selected.configuration_id}:${selected.configuration_version}:${prepared.prompt_hash}`
      let conversation = state.conversations[payload.conversationId]
      if (conversation && conversation.binding !== key) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
      if (!conversation) {
        const created = await state.request<{ session_id: string }>('session.create', {
          text_only: true, owner: state.owner, profile: state.profile, owner_scope: state.ownerScope,
          registration_id: selected.configuration_id, generation: selected.configuration_version,
          conversation_id: payload.conversationId, prompt_hash: prepared.prompt_hash
        }, 10000)
        current()
        if (!created.session_id.startsWith('enterprise-text-runtime-')) {throw finite('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')}
        conversation = { id: created.session_id, binding: key }
        state.conversations[payload.conversationId] = conversation
      }
      pending = { conversationId: payload.conversationId, requestId, content, contentHash: hash(content), personaId: payload.personaId,
        prepared, deadline: now() + prepared.expires_in * 1000, choice: selected, gatewaySessionId: conversation.id,
        stopped: false, attempted: false }
      state.requests[requestId] = pending
      const released = await deps.context({ action: 'revalidate', mode: 'summarize', content, persona_id: pending.personaId,
        conversation_id: pending.conversationId, request_id: requestId, prepared_at: prepared.prepared_at,
        expected_context_hash: prepared.context_hash })
      current()
      if (released.context_hash !== prepared.context_hash || now() >= pending.deadline || pending.stopped || !sameChoice(await account(), selected)) {
        throw finite('LOCAL_TEXT_CONTEXT_CHANGED')
      }
      current()
      if (session.localTextStops?.has(requestId)) {throw finite('LOCAL_TEXT_OBSERVATION_STOPPED')}
      pending.attempted = true
      pending.inFlight = true
      const observed = await state.request<any>('enterprise_text.submit', { owner: state.owner,
        session_id: pending.gatewaySessionId, request_id: requestId, instructions: prepared.instructions, input: prepared.input })
      current()
      pending.inFlight = false
      return await finish(observed, false)
    }
    if (!pending || !sameChoice(pending.choice, selected)) {throw finite('LOCAL_TEXT_RESULT_UNKNOWN')}
    if (pending.completed) {return pending.completed}
    const observed = await state.request<any>('enterprise_text.status', {
      owner: state.owner, session_id: pending.gatewaySessionId, request_id: requestId }, 5000)
    current()
    return await finish(observed, true)

    async function finish(observed: any, explicitQuery: boolean): Promise<LocalTextReply> {
      current()
      if (!pending || now() >= pending.deadline || (!explicitQuery && pending.stopped)) {throw finite('LOCAL_TEXT_RESULT_UNKNOWN')}
      const draft = observed.state === 'completed' ? pending.accepted?.text : observed.draft
      if (!['received', 'completed'].includes(observed.state) || typeof draft !== 'string') {
        const reasons: Record<string, string> = { TEXT_AUTHORIZATION_REQUIRED: 'LOCAL_TEXT_AUTHORIZATION_REQUIRED',
          TEXT_MODEL_OR_REQUEST_UNAVAILABLE: 'LOCAL_TEXT_MODEL_UNAVAILABLE', TEXT_RATE_LIMITED: 'LOCAL_TEXT_RATE_LIMITED' }
        return { state: observed.state === 'failed' ? 'failed' : 'unknown', reason: reasons[observed.reason] ?? 'LOCAL_TEXT_RESULT_UNKNOWN', requestId }
      }
      if (!sameChoice(await account(), pending.choice)) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
      const accepted = await deps.context({ action: 'accept', mode: 'summarize', content: pending.content,
        persona_id: pending.personaId, conversation_id: pending.conversationId, request_id: requestId,
        prepared_at: pending.prepared.prepared_at, expected_context_hash: pending.prepared.context_hash, answer: draft })
      current()
      if (accepted.owner_scope !== state.ownerScope || accepted.context_hash !== pending.prepared.context_hash ||
          typeof accepted.text !== 'string' || now() >= pending.deadline || (!explicitQuery && pending.stopped) ||
          !sameChoice(await account(), pending.choice)) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
      current()
      pending.accepted = { state: 'completed', text: accepted.text, requestId, backend_choice: pending.choice }
      await state.request('enterprise_text.accept', { owner: state.owner, session_id: pending.gatewaySessionId, request_id: requestId }, 5000)
      current()
      if (!sameChoice(await account(), pending.choice)) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
      current()
      pending.completed = pending.accepted
      pending.content = ''
      pending.prepared.instructions = ''
      pending.prepared.input = ''
      return pending.completed
    }
  } catch (error) {
    if (pending) {pending.inFlight = false}
    const reason = error instanceof Error && /^LOCAL_TEXT_[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_TEXT_UNAVAILABLE'
    return { state: pending?.attempted ? 'unknown' : 'unavailable', reason }
  }
}
