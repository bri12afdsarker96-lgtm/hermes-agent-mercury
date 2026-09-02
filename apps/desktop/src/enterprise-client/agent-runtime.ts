/**
 * Product-owned adapter for Hermes' agent runtime.
 *
 * The Enterprise client owns its session and transcript presentation. Hermes
 * supplies only the gateway protocol, session persistence, and agent runtime.
 * Connection credentials remain in Electron main; the renderer receives a
 * WebSocket URL only through the existing secure preload bridge.
 */
import { type GatewayEvent, JsonRpcGatewayClient, resolveGatewayWsUrl } from '@hermes/shared'

import type { HermesConnection } from '@/global'

export interface EnterpriseAgentSession {
  id: string
  message_count: number
  preview: string
  source: string
  started_at: number
  title: string
}

export interface EnterpriseAgentMessage {
  content: unknown
  role: 'assistant' | 'system' | 'tool' | 'user'
  text?: unknown
}

export interface EnterpriseAgentResume {
  messages: EnterpriseAgentMessage[]
  session_id: string
}

interface SessionListResponse {
  sessions?: EnterpriseAgentSession[]
}

interface SessionCreateResponse {
  session_id: string
}

export interface EnterpriseAgentRuntime {
  close(): void
  createSession(): Promise<string>
  listSessions(): Promise<EnterpriseAgentSession[]>
  onEvent(handler: (event: GatewayEvent) => void): () => void
  resumeSession(sessionId: string): Promise<EnterpriseAgentResume>
  submit(sessionId: string, text: string): Promise<void>
}

const PROMPT_SUBMIT_TIMEOUT_MS = 30 * 60 * 1000

function isEnterpriseConnection(value: HermesConnection | undefined): value is HermesConnection {
  return Boolean(value?.wsUrl)
}

export async function connectEnterpriseAgent(): Promise<EnterpriseAgentRuntime> {
  const desktop = window.hermesDesktop

  if (!desktop) {
    throw new Error('desktop secure bridge is unavailable')
  }

  const connection = await desktop.getConnection()

  if (!isEnterpriseConnection(connection)) {
    throw new Error('Hermes runtime connection is unavailable')
  }

  const gateway = new JsonRpcGatewayClient({
    closedErrorMessage: 'Hermes runtime connection closed',
    connectErrorMessage: 'Could not connect to Hermes runtime',
    notConnectedErrorMessage: 'Hermes runtime is not connected'
  })
  const wsUrl = await resolveGatewayWsUrl(desktop, connection)

  await gateway.connect(wsUrl)

  return {
    close() {
      gateway.close()
    },
    async createSession() {
      const response = await gateway.request<SessionCreateResponse>('session.create', {
        cols: 96,
        source: 'desktop'
      })

      return response.session_id
    },
    async listSessions() {
      const response = await gateway.request<SessionListResponse>('session.list', { limit: 24 })

      return response.sessions ?? []
    },
    onEvent(handler) {
      return gateway.onEvent(handler)
    },
    async resumeSession(sessionId) {
      return gateway.request<EnterpriseAgentResume>('session.resume', {
        cols: 96,
        session_id: sessionId,
        source: 'desktop'
      })
    },
    async submit(sessionId, text) {
      await gateway.request('prompt.submit', { session_id: sessionId, text }, PROMPT_SUBMIT_TIMEOUT_MS)
    }
  }
}
