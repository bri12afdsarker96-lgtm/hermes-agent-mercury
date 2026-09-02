/**
 * Product-owned bridge to Hermes_AI. The renderer handles neither a bearer nor
 * a server address: Electron main resolves both and returns only a fenced,
 * opaque session id.
 */

import {
  EnterpriseClientError,
  enterpriseClientErrorForStatus,
  enterpriseNetworkError
} from './runtime-errors'

export { EnterpriseClientError } from './runtime-errors'

export interface EnterpriseAlert {
  code?: string
  level?: string
  message?: string
}

export interface EnterpriseHealth {
  auth_mode?: string
  ok?: boolean
}

export interface EnterpriseIdentity {
  name?: string
  principal_id?: string
  product_capabilities?: Record<string, { enabled?: boolean; status?: string }>
  role?: string
  tenant_id?: string
}

export interface EnterpriseMetrics {
  alerts?: EnterpriseAlert[]
}

export interface EnterpriseClientRuntime {
  disconnect(): Promise<void>
  get<T>(path: string): Promise<T>
  post?<T>(path: string, body: unknown): Promise<T>
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
    throw enterpriseNetworkError()
  }

  const { sessionId } = connected

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    try {
      const response = await enterpriseBridge.request({ body, method, path, sessionId })

      if (response.kind !== 'ok') {
        throw enterpriseClientErrorForStatus(response.status)
      }

      return response.data as T
    } catch (reason) {
      const clientError = reason instanceof EnterpriseClientError ? reason : enterpriseNetworkError()

      if (clientError.kind === 'authentication_required') {
        options.onAuthenticationRequired?.(clientError)
      }

      throw clientError
    }
  }

  return {
    async disconnect() {
      await enterpriseBridge.disconnect(sessionId)
    },
    async get<T>(path: string) {
      return request<T>('GET', path)
    },
    async post<T>(path: string, body: unknown) {
      return request<T>('POST', path, body)
    }
  }
}
