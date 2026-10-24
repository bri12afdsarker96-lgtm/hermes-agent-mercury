import crypto from 'node:crypto'

import { JsonRpcGatewayClient, type GatewayEvent } from '../../shared/src/json-rpc-gateway'

import type { EnterpriseSession } from './enterprise-transport'
import type { LocalTextChoice, LocalTextRequest, LocalTextReply } from './enterprise-local-text-types'
export type { LocalTextRequest } from './enterprise-local-text-types'

interface Context {
  owner_scope: string
  context_hash: string
  prompt_hash: string
  prepared_at: number
  expires_in: number
  expires_at?: number
  input_hash?: string
  instructions?: string
  input?: string
  model: string
  reasoning_effort: string
  runtime_protocol: string
  answer?: string
  text?: string
  phase_nonce?: string
  single_use?: boolean
  phase?: string
}

interface Pending {
  conversationId: string
  requestId: string
  content: string
  contentHash: string
  personaId?: string
  mode: 'summarize' | 'knowledge_answer'
  references: Record<string, unknown>
  referenceHash: string
  prepared?: Context
  deadline: number
  choice: LocalTextChoice
  gatewaySessionId: string
  stopped: boolean
  attempted: boolean
  inFlight?: boolean
  completed?: LocalTextReply
  accepted?: LocalTextReply
  releasePhase?: 'waiting' | 'authorizing' | 'acknowledged' | 'failed'
  releaseRequired?(event: GatewayEvent): Promise<void>
}

type TextClient = Pick<JsonRpcGatewayClient, 'connect' | 'request' | 'close'> & Partial<Pick<JsonRpcGatewayClient, 'onEvent'>>

interface Account {
  registrationId: string
  generation: number
}

interface ModelCheck {
  account?: Account
  status: NonNullable<LocalTextReply['modelStatus']>
}

export interface LocalTextDependencies {
  assertCurrent(): void
  context(body: Record<string, unknown>): Promise<Context>
  localConnection(): Promise<{ baseUrl: string; wsUrl: string; token: string; mode?: string; source?: string }>
  localApi(connection: { baseUrl: string; token: string }, path: string, owner: string, method: string): Promise<any>
  proof(connection: { baseUrl: string; token: string }, operation: string, payload: unknown, channel: string, runtimeId?: string): string
  now?(): number
  createClient?(): TextClient
}

export interface EnterpriseLocalTextState {
  ownerScope: string
  profile: string
  owner: string
  closed: boolean
  epoch: number
  loginId?: string
  loginStarting: boolean
  modelCheck?: ModelCheck
  requests: Record<string, Pending>
  conversations: Record<string, { id: string; binding: string }>
  init: Promise<void>
  client: TextClient
  lastSendRelease: boolean
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
  const allowed = new Set(['sessionId', 'action', 'conversationId', 'requestId', 'content', 'personaId', 'choice',
    'mode', 'customerId', 'workspaceRevision', 'customerOwnerId', 'conversationRevision', 'knowledgeQuery', 'replyPreferences'])
  if (!payload || Object.keys(payload).some(key => !allowed.has(key)) ||
      (payload.mode !== undefined && !['summarize', 'knowledge_answer'].includes(payload.mode)) ||
      !['status', 'connect', 'checkModel', 'cancelLogin', 'logout', 'submit', 'requestStatus', 'stop'].includes(payload.action)) {
    throw finite('LOCAL_TEXT_REQUEST_INVALID')
  }
}

function knowledgeReferences(payload: LocalTextRequest): Record<string, unknown> {
  const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
  if (!uuid(payload.customerId) || payload.conversationId !== payload.customerId || !uuid(payload.requestId)) {throw finite('LOCAL_TEXT_ASSOCIATION_INVALID')}
  const shared = payload.customerOwnerId !== undefined
  if (shared ? (typeof payload.customerOwnerId !== 'string' || !payload.customerOwnerId.trim() || payload.customerOwnerId.length > 256 ||
      !Number.isSafeInteger(payload.conversationRevision) || payload.conversationRevision! < 0 || payload.workspaceRevision !== undefined)
    : (!Number.isSafeInteger(payload.workspaceRevision) || payload.workspaceRevision! < 1 || payload.conversationRevision !== undefined)) {throw finite('LOCAL_TEXT_ASSOCIATION_INVALID')}
  if (payload.knowledgeQuery !== undefined && (typeof payload.knowledgeQuery !== 'string' || !payload.knowledgeQuery.trim() || payload.knowledgeQuery.length > 1000)) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
  const preferences = payload.replyPreferences
  if (preferences !== undefined && (!preferences || Object.getPrototypeOf(preferences) !== Object.prototype || Object.keys(preferences).length !== 3 ||
      !['professional', 'warm'].includes(preferences.tone) || !['concise', 'balanced', 'detailed'].includes(preferences.length) || !['nin', 'ni'].includes(preferences.address))) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
  return { customer_id: payload.customerId, ...(shared ? { customer_owner_id: payload.customerOwnerId, conversation_revision: payload.conversationRevision }
    : { workspace_revision: payload.workspaceRevision }), ...(payload.knowledgeQuery !== undefined ? { knowledge_query: payload.knowledgeQuery } : {}),
  ...(preferences ? { reply_preferences: { ...preferences } } : {}) }
}

function contextRequest(pending: Pending, state: EnterpriseLocalTextState, action: string): Record<string, unknown> {
  return { action, mode: pending.mode, content: pending.content, ...(pending.personaId !== undefined ? { persona_id: pending.personaId } : {}),
    conversation_id: pending.conversationId, request_id: pending.requestId, ...pending.references,
    ...(pending.mode === 'knowledge_answer' ? { owned_binding: { registration_id: pending.choice.configuration_id,
      generation: pending.choice.configuration_version, profile_scope: hash(state.profile) } } : {}),
    ...(pending.prepared ? { prepared_at: pending.prepared.prepared_at, expected_context_hash: pending.prepared.context_hash } : {}) }
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
    let unsubscribe = () => {}
    const state: EnterpriseLocalTextState = {
      ownerScope, profile, owner, closed: false, epoch: 0, loginStarting: false, requests: Object.create(null), conversations: Object.create(null), client,
      init: Promise.resolve(), lastSendRelease: false,
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
        state.modelCheck = undefined
        unsubscribe()
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
      unsubscribe = client.onEvent?.(event => {
        if (event.type !== 'enterprise_text.release_required' || state.closed) {return}
        const requestId = (event.payload as { request_id?: unknown } | undefined)?.request_id
        if (typeof requestId !== 'string') {return}
        const pending = state.requests[requestId]
        if (!pending?.releaseRequired) {return}
        void pending.releaseRequired(event).catch(() => {
          pending.releasePhase = 'failed'
          pending.stopped = true
          try {
            void state.request('enterprise_text.stop', { owner, session_id: pending.gatewaySessionId, request_id: requestId }, 5000).catch(() => undefined)
          } catch { /* The old runtime authority may already be gone. */ }
        })
      }) ?? (() => {})
      const capabilities = await client.request<{ protocol_version: number; runtime_id: string; channel_id: string; last_send_release?: boolean }>('enterprise_text.capabilities', {}, 5000)
        .catch(() => {throw finite('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')})
      if (capabilities.protocol_version !== 2 || !/^[a-f0-9]{32}$/.test(capabilities.runtime_id) || !/^[a-f0-9]{32}$/.test(capabilities.channel_id)) {throw finite('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')}
      runtimeId = capabilities.runtime_id
      channel = capabilities.channel_id
      state.lastSendRelease = capabilities.last_send_release === true && typeof client.onEvent === 'function'
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

function accountFrom(status: any): Account {
  if (status.state !== 'ready' || !/^[a-f0-9]{32}$/.test(status.registration_id) || !Number.isSafeInteger(status.generation) || status.generation < 0) {
    throw finite(['disconnected', 'reconnect_required'].includes(status.state) ? 'LOCAL_TEXT_CONNECT_REQUIRED' : 'LOCAL_TEXT_CONNECTION_CHECK_FAILED')
  }
  return { registrationId: status.registration_id, generation: status.generation }
}

function sameAccount(left: Account, right: Account) {
  return left.registrationId === right.registrationId && left.generation === right.generation
}

function choiceAccountMatches(choice: LocalTextChoice, account: Account) {
  return choice.configuration_id === account.registrationId && choice.configuration_version === account.generation
}

function supportedChoice(account: Account): LocalTextChoice {
  return { backend_id: 'codex', configuration_id: account.registrationId, configuration_version: account.generation,
    model: 'gpt-6-luna', reasoning_effort: 'medium', runtime_protocol: 'codex_responses', availability: 'available' }
}

const modelReasons = { unverified: 'LOCAL_TEXT_MODEL_UNVERIFIED', checking: 'LOCAL_TEXT_MODEL_CHECKING',
  supported: 'LOCAL_TEXT_MODEL_SUPPORTED', unsupported: 'LOCAL_TEXT_MODEL_UNSUPPORTED', unconfirmed: 'LOCAL_TEXT_MODEL_CHECK_FAILED' } as const

function connectionReply(state: EnterpriseLocalTextState, account: Account): LocalTextReply {
  const check = state.modelCheck
  const modelStatus = check?.status === 'checking' ? 'checking'
    : check?.account && sameAccount(check.account, account) ? check.status : 'unverified'
  return { state: modelStatus === 'supported' ? 'ready' : 'connected', modelStatus,
    reason: modelReasons[modelStatus], ...(modelStatus === 'supported' ? { choice: supportedChoice(account) } : {}) }
}

function sameChoice(left: LocalTextChoice, right: LocalTextChoice) {
  return Object.keys(right).every(key => left[key as keyof LocalTextChoice] === right[key as keyof LocalTextChoice])
}

export async function operateEnterpriseLocalText(session: EnterpriseSession, payload: LocalTextRequest, deps: LocalTextDependencies): Promise<LocalTextReply> {
  let pending: Pending | undefined
  let reservation: { state: EnterpriseLocalTextState; check: ModelCheck; owns: boolean } | undefined
  try {
    assertPayload(payload)
    const mode = payload.mode ?? 'summarize'
    const references = payload.action === 'submit' && mode === 'knowledge_answer' ? knowledgeReferences(payload) : {}
    if (mode === 'summarize' && ['customerId', 'workspaceRevision', 'customerOwnerId', 'conversationRevision', 'knowledgeQuery', 'replyPreferences'].some(key => Object.hasOwn(payload, key))) {throw finite('LOCAL_TEXT_REQUEST_INVALID')}
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
      state.modelCheck = undefined
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
    // Revoke old eligibility before even the enterprise-status await. A
    // concurrent renderer cannot submit with it while that check is pending.
    const existing = session.localText
    if (payload.action === 'connect' && existing) {existing.modelCheck = undefined}
    if (payload.action === 'checkModel' && existing && !existing.closed && !existing.loginStarting && !existing.loginId) {
      const running = existing.modelCheck?.status === 'checking'
      const check: ModelCheck = running ? existing.modelCheck! : { status: 'checking' }
      if (!running) {existing.modelCheck = check}
      reservation = { state: existing, check, owns: !running }
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
      const checkAtRead = state.modelCheck
      try {
        const status = await state.api('/api/providers/siwc/status')
        current()
        const selected = accountFrom(status)
        if (state.modelCheck === checkAtRead && checkAtRead?.account && !sameAccount(checkAtRead.account, selected)) {state.modelCheck = undefined}
        return selected
      } catch (error) {if (state.modelCheck === checkAtRead) {state.modelCheck = undefined}; throw error}
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
      try {return connectionReply(state, await account())}
      catch (error) {return error instanceof Error && error.message === 'LOCAL_TEXT_CONNECT_REQUIRED'
        ? { state: 'disconnected', reason: 'LOCAL_TEXT_CONNECT_REQUIRED' }
        : { state: 'unavailable', reason: 'LOCAL_TEXT_CONNECTION_CHECK_FAILED' }}
    }
    if (payload.action === 'checkModel') {
      if (state.loginStarting || state.loginId) {return { state: 'connecting' }}
      if (reservation && reservation.state !== state) {throw finite('LOCAL_TEXT_OWNER_CHANGED')}
      if ((reservation && !reservation.owns) || (!reservation && state.modelCheck)) {
        return connectionReply(state, await account())
      }
      const check: ModelCheck = reservation?.check ?? { status: 'checking' }
      if (!reservation) {state.modelCheck = check; reservation = { state, check, owns: true }}
      if (state.modelCheck !== check) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
      try {
        const selected = await account()
        if (state.modelCheck !== check) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
        check.account = selected
        const reply = await state.api(`/api/providers/siwc/models/check?registration_id=${selected.registrationId}&generation=${selected.generation}`, 'POST')
        current()
        if (state.modelCheck !== check) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
        const after = await account()
        if (state.modelCheck !== check || !sameAccount(selected, after)) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
        if (!reply || reply.registration_id !== selected.registrationId || reply.generation !== selected.generation ||
            reply.model !== 'gpt-6-luna' || reply.reasoning_effort !== 'medium' ||
            !['supported', 'unsupported', 'unconfirmed'].includes(reply.model_status)) {
          throw finite('LOCAL_TEXT_MODEL_CHECK_FAILED')
        }
        check.status = reply.model_status
        return connectionReply(state, selected)
      } catch (error) {
        try {current()} catch (changed) {if (state.modelCheck === check) {state.modelCheck = undefined}; throw changed}
        if (state.modelCheck === check && check.account) {
          check.status = 'unconfirmed'
          return connectionReply(state, check.account)
        }
        throw error
      }
    }
    if (payload.action === 'connect') {
      if (state.loginStarting || state.loginId) {return { state: 'connecting' }}
      if (Object.values(state.requests).some(item => item.inFlight)) {throw finite('LOCAL_TEXT_RESULT_UNKNOWN')}
      state.modelCheck = undefined
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
    const selectedAccount = await account()
    current()
    // Another submit can reserve this root while account I/O is waiting.
    pending = state.requests[requestId]
    if (pending && (pending.conversationId !== payload.conversationId || (payload.action === 'submit' &&
        (pending.mode !== mode || pending.referenceHash !== hash(canonicalTextProofPayload(references)) ||
         typeof payload.content !== 'string' || hash(payload.content) !== pending.contentHash ||
         payload.personaId !== pending.personaId || !payload.choice || !sameChoice(payload.choice, pending.choice))))) {throw finite('LOCAL_TEXT_REQUEST_CHANGED')}
    if (pending?.inFlight) {return { state: 'unknown', reason: 'LOCAL_TEXT_RESULT_UNKNOWN', requestId }}
    if (payload.action === 'submit' && !pending) {
      const support = state.modelCheck
      if (support?.status !== 'supported' || !support.account || !sameAccount(support.account, selectedAccount)) {
        throw finite(modelReasons[state.modelCheck?.status ?? 'unverified'])
      }
      const selected = supportedChoice(selectedAccount)
      if (mode === 'knowledge_answer' && !state.lastSendRelease) {throw finite('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')}
      if (session.localTextStops?.has(requestId)) {throw finite('LOCAL_TEXT_OBSERVATION_STOPPED')}
      if (!payload.choice || !sameChoice(payload.choice, selected) || typeof payload.content !== 'string' ||
          !payload.content.trim() || payload.content.length > 24000 ||
          Object.values(state.requests).some(item => item.inFlight || item.conversationId === payload.conversationId && item.attempted && !item.completed) || Object.keys(state.requests).length >= 128) {
        throw finite('LOCAL_TEXT_REQUEST_INVALID')
      }
      const content = payload.content
      const started = now()
      // Reserve before the first prepare await; a concurrent root cannot start
      // another business attempt or replace the pending release consumer.
      pending = { conversationId: payload.conversationId!, requestId, content, contentHash: hash(content), personaId: payload.personaId,
        mode, references, referenceHash: hash(canonicalTextProofPayload(references)), deadline: started + 180000, choice: selected,
        gatewaySessionId: '', stopped: false, attempted: false, inFlight: true, releasePhase: 'waiting' }
      state.requests[requestId] = pending
      const prepared = await deps.context(contextRequest(pending, state, 'prepare'))
      current()
      if (prepared.owner_scope !== state.ownerScope || prepared.model !== selected.model ||
          prepared.reasoning_effort !== selected.reasoning_effort || prepared.runtime_protocol !== selected.runtime_protocol ||
          typeof prepared.instructions !== 'string' || hash(prepared.instructions) !== prepared.prompt_hash ||
          typeof prepared.input !== 'string' || !/^[a-f0-9]{64}$/.test(prepared.context_hash) ||
          !(prepared.expires_in > 0 && prepared.expires_in <= 180)) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
      if (mode === 'knowledge_answer' && (prepared.input_hash !== hash(prepared.input) ||
          !Number.isSafeInteger(prepared.prepared_at) || prepared.expires_at !== prepared.prepared_at + 180 ||
          prepared.instructions.length > 16000 || prepared.input.length > 26000)) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
      pending.prepared = prepared
      pending.deadline = started + prepared.expires_in * 1000
      if (now() >= pending.deadline || pending.stopped) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
      const key = `${selected.configuration_id}:${selected.configuration_version}:${prepared.prompt_hash}`
      const runtimeScope = mode === 'knowledge_answer' ? hash(canonicalTextProofPayload({
        root: requestId, phase: 'draft', prompt_hash: prepared.prompt_hash
      })) : payload.conversationId!
      let conversation = state.conversations[runtimeScope]
      if (conversation && conversation.binding !== key) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
      if (!conversation) {
        const created = await state.request<{ session_id: string }>('session.create', {
          text_only: true, owner: state.owner, profile: state.profile, owner_scope: state.ownerScope,
          registration_id: selected.configuration_id, generation: selected.configuration_version,
          conversation_id: runtimeScope, prompt_hash: prepared.prompt_hash
        }, 10000)
        current()
        if (!created.session_id.startsWith('enterprise-text-runtime-')) {throw finite('LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED')}
        conversation = { id: created.session_id, binding: key }
        state.conversations[runtimeScope] = conversation
      }
      pending.gatewaySessionId = conversation.id
      const released = await deps.context(contextRequest(pending, state, 'revalidate'))
      current()
      if (released.context_hash !== prepared.context_hash || (mode === 'knowledge_answer' &&
          (released.input_hash !== prepared.input_hash || released.prepared_at !== prepared.prepared_at || released.expires_at !== prepared.expires_at)) ||
          now() >= pending.deadline || pending.stopped || !choiceAccountMatches(selected, await account())) {
        throw finite('LOCAL_TEXT_CONTEXT_CHANGED')
      }
      current()
      if (session.localTextStops?.has(requestId)) {throw finite('LOCAL_TEXT_OBSERVATION_STOPPED')}
      if (state.modelCheck !== support || support.status !== 'supported') {throw finite('LOCAL_TEXT_MODEL_UNVERIFIED')}
      if (mode === 'knowledge_answer') {
        const request = pending
        request.releaseRequired = async event => {
          if (request.releasePhase !== 'waiting') {return}
          const body = event.payload as Record<string, unknown> | undefined
          if (!body || Object.keys(body).sort().join(',') !== 'context_hash,generation,input_hash,nonce,phase,registration_id,request_id' ||
              event.session_id !== request.gatewaySessionId || body.request_id !== request.requestId ||
              typeof body.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(body.nonce) || body.phase !== 'draft' ||
              body.input_hash !== prepared.input_hash || body.context_hash !== prepared.context_hash ||
              body.registration_id !== selected.configuration_id || body.generation !== selected.configuration_version) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
          // Occupy the single phase before account/S waits; duplicate events
          // cannot create concurrent releases or a second ACK.
          request.releasePhase = 'authorizing'
          current()
          if (request.stopped || now() >= request.deadline || !choiceAccountMatches(selected, await account())) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
          current()
          if (state.modelCheck !== support || support.status !== 'supported') {throw finite('LOCAL_TEXT_MODEL_UNVERIFIED')}
          const lease = await deps.context({ ...contextRequest(request, state, 'release'), phase_nonce: body.nonce })
          // Last S authority is followed only by memory checks and private ACK.
          current()
          if (request.stopped || now() >= request.deadline || state.requests[requestId] !== request ||
              state.modelCheck !== support || support.status !== 'supported' || lease.owner_scope !== state.ownerScope || lease.context_hash !== prepared.context_hash ||
              lease.input_hash !== prepared.input_hash || lease.prepared_at !== prepared.prepared_at ||
              lease.expires_at !== prepared.expires_at || lease.phase_nonce !== body.nonce || lease.single_use !== true ||
              lease.phase !== 'draft' || lease.instructions !== undefined || lease.input !== undefined) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
          const ack = await state.request<{ released: boolean; phase: string }>('enterprise_text.release', {
            owner: state.owner, session_id: request.gatewaySessionId, request_id: requestId, nonce: body.nonce,
            input_hash: body.input_hash, context_hash: body.context_hash, registration_id: body.registration_id,
            generation: body.generation, phase: 'draft'
          }, 5000)
          current()
          if (!ack.released || ack.phase !== 'draft' || request.stopped || now() >= request.deadline ||
              state.modelCheck !== support || support.status !== 'supported') {throw finite('LOCAL_TEXT_RESULT_UNKNOWN')}
          request.releasePhase = 'acknowledged'
        }
      }
      pending.attempted = true
      pending.inFlight = true
      const observed = await state.request<any>('enterprise_text.submit', { owner: state.owner,
        session_id: pending.gatewaySessionId, request_id: requestId, instructions: prepared.instructions, input: prepared.input,
        ...(mode === 'knowledge_answer' ? { mode, context_hash: prepared.context_hash, input_hash: prepared.input_hash,
          deadline_ms: Math.floor(Date.now() + Math.max(0, pending.deadline - now())) } : {}) })
      current()
      pending.inFlight = false
      return await finish(observed, false)
    }
    if (!pending || !choiceAccountMatches(pending.choice, selectedAccount)) {throw finite('LOCAL_TEXT_RESULT_UNKNOWN')}
    if (!pending.prepared || !pending.gatewaySessionId) {return { state: 'unknown', reason: 'LOCAL_TEXT_RESULT_UNKNOWN', requestId }}
    if (pending.completed) {return pending.completed}
    const observed = await state.request<any>('enterprise_text.status', {
      owner: state.owner, session_id: pending.gatewaySessionId, request_id: requestId }, 5000)
    current()
    return await finish(observed, true)

    async function finish(observed: any, explicitQuery: boolean): Promise<LocalTextReply> {
      current()
      if (!pending || !pending.prepared || now() >= pending.deadline || (!explicitQuery && pending.stopped)) {throw finite('LOCAL_TEXT_RESULT_UNKNOWN')}
      const prepared = pending.prepared
      if (pending.mode === 'knowledge_answer') {
        // S customer accept/query is a separate increment. Never substitute
        // summary acceptance or expose a received raw customer draft to IPC.
        return { state: observed.state === 'failed' ? 'failed' : 'unknown', requestId,
          reason: observed.state === 'received' ? 'LOCAL_TEXT_CUSTOMER_ACCEPT_PENDING' : 'LOCAL_TEXT_RESULT_UNKNOWN' }
      }
      const draft = observed.state === 'completed' ? pending.accepted?.text : observed.draft
      if (!['received', 'completed'].includes(observed.state) || typeof draft !== 'string') {
        const reasons: Record<string, string> = { TEXT_AUTHORIZATION_REQUIRED: 'LOCAL_TEXT_AUTHORIZATION_REQUIRED',
          TEXT_MODEL_OR_REQUEST_UNAVAILABLE: 'LOCAL_TEXT_MODEL_UNAVAILABLE', TEXT_RATE_LIMITED: 'LOCAL_TEXT_RATE_LIMITED' }
        return { state: observed.state === 'failed' ? 'failed' : 'unknown', reason: reasons[observed.reason] ?? 'LOCAL_TEXT_RESULT_UNKNOWN', requestId }
      }
      if (!choiceAccountMatches(pending.choice, await account())) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
      const accepted = await deps.context({ action: 'accept', mode: 'summarize', content: pending.content,
        persona_id: pending.personaId, conversation_id: pending.conversationId, request_id: requestId,
        prepared_at: prepared.prepared_at, expected_context_hash: prepared.context_hash, answer: draft })
      current()
      if (accepted.owner_scope !== state.ownerScope || accepted.context_hash !== prepared.context_hash ||
          typeof accepted.text !== 'string' || now() >= pending.deadline || (!explicitQuery && pending.stopped) ||
          !choiceAccountMatches(pending.choice, await account())) {throw finite('LOCAL_TEXT_CONTEXT_CHANGED')}
      current()
      pending.accepted = { state: 'completed', text: accepted.text, requestId, backend_choice: pending.choice }
      await state.request('enterprise_text.accept', { owner: state.owner, session_id: pending.gatewaySessionId, request_id: requestId }, 5000)
      current()
      if (!choiceAccountMatches(pending.choice, await account())) {throw finite('LOCAL_TEXT_ACCOUNT_CHANGED')}
      current()
      pending.completed = pending.accepted
      pending.content = ''
      prepared.instructions = ''
      prepared.input = ''
      return pending.completed
    }
  } catch (error) {
    if (reservation?.owns && reservation.state.modelCheck === reservation.check && reservation.check.status === 'checking') {
      reservation.state.modelCheck = undefined
    }
    if (pending) {pending.inFlight = false}
    const reason = error instanceof Error && /^LOCAL_TEXT_[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_TEXT_UNAVAILABLE'
    return { state: pending?.attempted ? 'unknown' : 'unavailable', reason }
  }
}
