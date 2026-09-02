/**
 * Product-owned bridge to Hermes_AI. The renderer handles neither a bearer nor
 * a server address: Electron main resolves both and returns only a fenced,
 * opaque session id.
 */

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

export class EnterpriseClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnterpriseClientError'
  }
}

export interface EnterpriseClientRuntime {
  disconnect(): Promise<void>
  get<T>(path: string): Promise<T>
  post?<T>(path: string, body: unknown): Promise<T>
}

export async function connectEnterpriseClient(): Promise<EnterpriseClientRuntime> {
  const bridge = window.hermesDesktop?.enterprise

  if (!bridge) {
    throw new EnterpriseClientError('desktop secure bridge is unavailable')
  }

  const connected = await bridge.autoConnect()

  if (!connected.ok) {
    throw new EnterpriseClientError(connected.message)
  }

  const { sessionId } = connected

  return {
    async disconnect() {
      await bridge.disconnect(sessionId)
    },
    async get<T>(path: string) {
      const response = await bridge.request({ method: 'GET', path, sessionId })

      if (response.kind !== 'ok') {
        throw new EnterpriseClientError(response.message)
      }

      return response.data as T
    },
    async post<T>(path: string, body: unknown) {
      const response = await bridge.request({ body, method: 'POST', path, sessionId })

      if (response.kind !== 'ok') {
        throw new EnterpriseClientError(response.message)
      }

      return response.data as T
    }
  }
}
