/**
 * Product-owned bridge to Hermes_AI. Electron main controls the server address
 * and credentials. Renderer requests use a fenced, opaque session id; the
 * public origin scopes presentation preferences, never request routing.
 */

import {
  EnterpriseClientError,
  enterpriseClientErrorForStatus,
  enterpriseNetworkError,
  enterprisePasswordLoginError
} from './runtime-errors'

export { EnterpriseClientError } from './runtime-errors'

export type EnterpriseAssistantBackendId = 'tenant_model' | 'codex'

/** Public selections only. Credentials and trusted identity remain on S. */
export interface EnterpriseAssistantBackendChoice {
  backend_id: EnterpriseAssistantBackendId
  configuration_id: string
  configuration_version?: number
  model: string
  runtime_protocol: string
  reasoning_effort: string | null
  availability: 'available' | 'unavailable'
  reason?: string | null
}

export interface EnterpriseAssistantBackendOption {
  backend_id: EnterpriseAssistantBackendId
  label: string
  runtime_protocol?: string
  model?: string
  reasoning_effort?: string | null
  availability?: 'available' | 'unavailable'
  reason?: string | null
}

export const CODEX_SOFTWARE_DEFAULTS = { model: 'gpt-6-luna', reasoning_effort: 'medium' } as const

export function assistantBackendReason(reason: string | null | undefined): string {
  const messages: Readonly<Record<string, string>> = {
    CODEX_LOCAL_RUNTIME_REQUIRED: '当前企业助手尚未接通本机 Codex。接通后由你使用自己的账号登录。',
    LOCAL_TEXT_CONNECT_REQUIRED: '请连接你自己的 ChatGPT 账号；实际模型权限以请求结果为准。',
    LOCAL_TEXT_AUTHORIZATION_REQUIRED: '本机账号授权需要重新连接，原请求不会自动重发。',
    LOCAL_TEXT_MODEL_UNAVAILABLE: '所连接账号的 gpt-6-luna / medium 请求不可用；未切换模型或账号。',
    LOCAL_TEXT_MODEL_UNVERIFIED: '本机账号已连接，尚未检查 gpt-6-luna / medium 的模型目录支持。',
    LOCAL_TEXT_MODEL_CHECKING: '本机账号已连接，正在检查模型目录。',
    LOCAL_TEXT_MODEL_SUPPORTED: '该账号目录已列出 gpt-6-luna，使用 medium；额度和实际可用性以请求结果为准。',
    LOCAL_TEXT_MODEL_UNSUPPORTED: '该账号目录未列出可使用的 gpt-6-luna；当前不能使用此模型。',
    LOCAL_TEXT_MODEL_CHECK_FAILED: '模型检查未确认，请稍后再次检查；账号未因此退出。',
    LOCAL_TEXT_CONNECTION_CHECK_FAILED: '本机连接状态未确认，请重新检查连接。',
    LOCAL_TEXT_RATE_LIMITED: '本机账号当前请求受限；请先核实原请求结果。',
    LOCAL_TEXT_RUNTIME_UPDATE_REQUIRED: '本机运行环境需要更新后才能使用文本摘要。',
    LOCAL_TEXT_RUNTIME_UNAVAILABLE: '本机运行环境暂未就绪，请检查本机连接后重试。',
    LOCAL_TEXT_LOCAL_RUNTIME_REQUIRED: '当前没有可用的本机运行环境。',
    LOCAL_TEXT_LOGIN_UNCONFIRMED: '本次登录未确认，请重新连接自己的账号。',
    LOCAL_TEXT_OWNER_CHANGED: '当前登录或窗口已变化，请重新打开本机连接。',
    LOCAL_TEXT_ACCOUNT_CHANGED: '本机模型账号已变化，请新建处理后重新选择。',
    LOCAL_TEXT_CONTEXT_CHANGED: '权限、人设或请求内容已变化，请新建处理后重试。',
    LOCAL_TEXT_RESULT_UNKNOWN: '结果尚未确认，未自动重发。可查询原请求，或保留记录并新建处理。',
    LOCAL_TEXT_OBSERVATION_STOPPED: '已停止本地观察，结果未确认；这不表示远端已取消或没有产生费用。',
    LOCAL_TEXT_UNAVAILABLE: '本机摘要暂不可用，请检查企业权限与本机连接。',
    // Older servers used a deployment-wide reason for this unimplemented local path.
    CODEX_QUALIFICATION_REQUIRED: '当前企业助手尚未接通本机 Codex。接通后由你使用自己的账号登录。',
    CONFIGURATION_CHANGED: '此对话的模型配置已变化，请新建对话后重新选择。',
    CONFIGURATION_UNAVAILABLE: '此对话的模型配置已不可用，请新建对话后重新选择。'
  }
  return messages[reason ?? ''] ?? '当前后端不可用，请联系企业管理员。'
}

export class EnterpriseAssistantRequestUnknown extends Error {
  constructor(reason?: string) {
    super(reason ? `${assistantBackendReason(reason)} 本次未自动重发。` : '本次 AI 请求结果未确认，未自动重发。请先核实结果，再发起新请求。')
    this.name = 'EnterpriseAssistantRequestUnknown'
  }
}

/** Only a definitive HTTP rejection can safely remain editable for another submission. */
export function assistantRequestError(reason: unknown): Error {
  if (reason instanceof EnterpriseAssistantRequestUnknown) {return reason}
  if (reason instanceof EnterpriseClientError && [400, 401, 403, 404, 409, 413, 422, 429].includes(reason.status)) {
    return enterpriseClientErrorForStatus(reason.status)
  }
  return new EnterpriseAssistantRequestUnknown()
}

/** All transmitted settings are assertions against the server-owned config. */
export function assistantChoiceRequest(choice: EnterpriseAssistantBackendChoice) {
  return {
    backend_id: choice.backend_id,
    configuration_id: choice.configuration_id || undefined,
    ...(choice.configuration_version !== undefined ? { configuration_version: choice.configuration_version } : {}),
    runtime_protocol: choice.runtime_protocol,
    model: choice.model,
    reasoning_effort: choice.reasoning_effort
  }
}

export function assistantChoicesMatch(left: EnterpriseAssistantBackendChoice, right: EnterpriseAssistantBackendChoice): boolean {
  return left.backend_id === right.backend_id && left.configuration_id === right.configuration_id &&
    left.configuration_version === right.configuration_version && left.runtime_protocol === right.runtime_protocol &&
    left.model === right.model && left.reasoning_effort === right.reasoning_effort
}

export interface EnterpriseAlert {
  code?: string
  level?: string
  message?: string
}

export interface EnterpriseHealth {
  auth_mode?: string
  ok?: boolean
}

export interface EnterpriseDesktopSurface {
  available?: boolean
}

export interface EnterpriseDesktopSurfaces {
  schema_version?: number
  surfaces?: Record<string, EnterpriseDesktopSurface>
}

export interface EnterpriseIdentity {
  tenant_name?: string
  desktop_surfaces?: EnterpriseDesktopSurfaces
  effective_permissions?: string[]
  name?: string
  principal_id?: string
  product_capabilities?: Record<string, { enabled?: boolean; status?: string }>
  role?: string
  tenant_id?: string
}

export interface EnterpriseMetrics {
  alerts?: EnterpriseAlert[]
  metrics?: {
    m15_biz_tasks?: {
      created?: number
      escalated?: number
    }
    m16_handoff?: {
      claimed?: number
    }
  }
}

export interface EnterpriseUpload {
  bytes: ArrayBuffer
  contentType: string
  filename: string
}

export interface EnterpriseMultipartFile extends EnterpriseUpload {
  field: 'call_file' | 'main_file'
}

export interface EnterpriseMultipartUpload {
  fields: Record<string, string>
  files: EnterpriseMultipartFile[]
}

export interface EnterpriseClientRuntime {
  localText?: (payload: Omit<import('../../electron/enterprise-local-text-types').LocalTextRequest, 'sessionId'>) => Promise<import('../../electron/enterprise-local-text-types').LocalTextReply>
  /** Non-secret scope for this device's per-seat presentation preferences. */
  serverOrigin?: string
  speech?: {
    status(): Promise<{ available: boolean }>
    speak(requestId: string, text: string): Promise<{ ok: boolean }>
    stop(requestId: string): Promise<{ ok: boolean }>
  }
  disconnect(): Promise<void>
  get<T>(path: string): Promise<T>
  post?<T>(path: string, body: unknown): Promise<T>
  upload?<T>(path: string, file: EnterpriseUpload): Promise<T>
  multipart?<T>(path: string, upload: EnterpriseMultipartUpload): Promise<T>
  download?(path: string): Promise<{ canceled?: boolean; path?: string; saved: boolean }>
}

export type EnterpriseLoginResult = { ok: true } | { code: string; message: string; ok: false }

/** A cold start without a session is an ordinary login prompt, not a failed
 * network request. Only main's explicit no-session result creates this state. */
export class EnterpriseLoginRequired extends Error {
  constructor() {
    super('请登录企业账号')
    this.name = 'EnterpriseLoginRequired'
  }
}

interface EnterpriseConnectedSession {
  baseUrl: string
  mustChangePassword?: boolean
  ok: true
  sessionId: string
}

/** Starts the configured, main-owned PKCE flow without exposing any auth
 * material or endpoint selection to the renderer. */
export async function beginEnterpriseLogin(): Promise<EnterpriseLoginResult> {
  const bridge = window.hermesDesktop?.enterprise

  if (!bridge) {
    return { code: 'bridge_unavailable', message: 'enterprise desktop bridge is unavailable', ok: false }
  }

  try {
    return await bridge.beginLogin()
  } catch {
    return { code: 'gateway_unavailable', message: 'enterprise gateway is unavailable', ok: false }
  }
}

/**
 * Exchanges a Chinese-labelled enterprise account/password form in Electron
 * main. The password is cleared by the caller immediately after this promise
 * starts; only an opaque, sender-fenced session id returns to the renderer.
 */
export async function beginEnterprisePasswordLogin(
  loginName: string,
  password: string,
  rememberPassword = false
): Promise<EnterpriseConnectedSession> {
  const bridge = window.hermesDesktop?.enterprise

  if (!bridge?.loginWithPassword) {
    throw enterpriseNetworkError()
  }

  let connected: Awaited<ReturnType<typeof bridge.loginWithPassword>>

  try {
    connected = await bridge.loginWithPassword({ loginName, password, rememberPassword })
  } catch {
    throw enterpriseNetworkError()
  }

  if (!connected.ok) {
    throw enterprisePasswordLoginError(connected.code)
  }

  return connected
}

export interface EnterpriseClientOptions {
  /**
   * The shell owns the opaque session lifecycle. Pages may only use the
   * runtime; a confirmed session expiry is reported here for the shell to
   * release it.
   */
  onAuthenticationRequired?: (reason: EnterpriseClientError) => void
}

export async function connectEnterpriseClient(options: EnterpriseClientOptions = {}): Promise<EnterpriseClientRuntime> {
  const bridge = window.hermesDesktop?.enterprise

  if (!bridge) {
    throw enterpriseNetworkError()
  }

  const enterpriseBridge = bridge
  let connected: Awaited<ReturnType<typeof enterpriseBridge.autoConnect>>

  try {
    connected = await enterpriseBridge.autoConnect()
  } catch {
    throw enterpriseNetworkError()
  }

  if (!connected.ok) {
    if (connected.code === 'no_native_session') {throw new EnterpriseLoginRequired()}
    throw enterpriseNetworkError()
  }

  return enterpriseRuntimeFromSession(enterpriseBridge, connected, options)
}

export async function connectEnterpriseClientWithPassword(
  loginName: string,
  password: string,
  options: EnterpriseClientOptions & { rememberPassword?: boolean } = {}
): Promise<{ mustChangePassword: boolean; runtime: EnterpriseClientRuntime }> {
  const bridge = window.hermesDesktop?.enterprise

  if (!bridge) {
    throw enterpriseNetworkError()
  }

  const connected = await beginEnterprisePasswordLogin(loginName, password, options.rememberPassword)

  return {
    mustChangePassword: connected.mustChangePassword === true,
    runtime: enterpriseRuntimeFromSession(bridge, connected, options)
  }
}

function enterpriseRuntimeFromSession(
  enterpriseBridge: NonNullable<Window['hermesDesktop']['enterprise']>,
  connected: EnterpriseConnectedSession,
  options: EnterpriseClientOptions
): EnterpriseClientRuntime {
  const { sessionId } = connected
  let disconnected = false

  async function retryRead<T>(path: string): Promise<T> {
    // GET requests are the only enterprise calls this adapter may replay. All
    // mutations keep their one-shot semantics so a timeout can never duplicate
    // a customer-facing or administrative action.
    const delays = [500, 1_000, 2_000]

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request<T>('GET', path)
      } catch (reason) {
        const retryable = reason instanceof EnterpriseClientError &&
          (reason.kind === 'network' || [502, 503, 504].includes(reason.status))

        if (!retryable || attempt >= delays.length) {
          throw reason
        }

        await new Promise(resolve => setTimeout(resolve, delays[attempt]))
      }
    }
  }

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (disconnected) {
      throw enterpriseClientErrorForStatus(401)
    }

    try {
      const response = await enterpriseBridge.request({ body, method, path, sessionId })

      if (response.kind !== 'ok') {
        throw enterpriseClientErrorForStatus(response.status)
      }

      return response.data as T
    } catch (reason) {
      const clientError = reason instanceof EnterpriseClientError ? reason : enterpriseNetworkError()

      if (!disconnected && clientError.kind === 'authentication_required') {
        options.onAuthenticationRequired?.(clientError)
      }

      throw clientError
    }
  }

  return {
    serverOrigin: new URL(connected.baseUrl).origin,
    localText: enterpriseBridge.localText ? async payload => {
      if (disconnected) {return { state: 'unavailable', reason: 'LOCAL_TEXT_OWNER_CHANGED' }}
      return enterpriseBridge.localText!({ ...payload, sessionId })
    } : undefined,
    speech: enterpriseBridge.speech ? {
      async status() {
        if (disconnected) {return { available: false }}

        return enterpriseBridge.speech!.status({ sessionId })
      },
      async speak(requestId, text) {
        if (disconnected) {return { ok: false }}

        return enterpriseBridge.speech!.speak({ requestId, sessionId, text })
      },
      async stop(requestId) {
        if (disconnected) {return { ok: false }}

        return enterpriseBridge.speech!.stop({ requestId, sessionId })
      }
    } : undefined,
    async disconnect() {
      if (disconnected) {
        return
      }

      // A queued request or a late 401 from this runtime must not operate on
      // the shell's next authenticated session.
      disconnected = true
      await enterpriseBridge.disconnect(sessionId)
    },
    async get<T>(path: string) {
      return retryRead<T>(path)
    },
    async post<T>(path: string, body: unknown) {
      return request<T>('POST', path, body)
    },
    async upload<T>(path: string, file: EnterpriseUpload) {
      if (disconnected) {
        throw enterpriseClientErrorForStatus(401)
      }

      try {
        const response = await enterpriseBridge.upload({ ...file, path, sessionId })

        if (response.kind !== 'ok') {
          throw enterpriseClientErrorForStatus(response.status)
        }

        return response.data as T
      } catch (reason) {
        const clientError = reason instanceof EnterpriseClientError ? reason : enterpriseNetworkError()

        if (!disconnected && clientError.kind === 'authentication_required') {
          options.onAuthenticationRequired?.(clientError)
        }

        throw clientError
      }
    },
    async multipart<T>(path: string, upload: EnterpriseMultipartUpload) {
      if (disconnected) {throw enterpriseClientErrorForStatus(401)}
      try {
        const response = await enterpriseBridge.multipart({...upload, path, sessionId})
        if (response.kind !== 'ok') {throw enterpriseClientErrorForStatus(response.status)}
        return response.data as T
      } catch (reason) {
        const clientError = reason instanceof EnterpriseClientError ? reason : enterpriseNetworkError()
        if (!disconnected && clientError.kind === 'authentication_required') {options.onAuthenticationRequired?.(clientError)}
        throw clientError
      }
    },
    async download(path: string) {
      if (disconnected) {throw enterpriseClientErrorForStatus(401)}
      return enterpriseBridge.download({path, sessionId})
    }
  }
}
