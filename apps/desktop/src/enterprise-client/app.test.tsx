import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnterpriseClientApp } from './app'

type EnterpriseBridgeResponse =
  | { data: unknown; kind: 'ok' }
  | { code: string; kind: 'error'; message: string; status: number }

const HEALTH = { auth_mode: 'native_bearer', ok: true }
const IDENTITY = {
  name: 'Lin Qiao',
  principal_id: 'principal-operator-042',
  product_capabilities: { knowledge_rag: { enabled: true, status: 'LIVE' } },
  role: 'operator',
  tenant_id: 'tenant-acme-logistics'
}
const METRICS = { alerts: [] }

function installAuthorityBridge(responses: Record<string, EnterpriseBridgeResponse>) {
  const bridge = {
    autoConnect: vi.fn(async () => ({
      baseUrl: 'https://enterprise.example.com',
      ok: true as const,
      sessionId: 'opaque-session'
    })),
    disconnect: vi.fn(async () => ({ ok: true })),
    request: vi.fn(async (request: { path: string }) => responses[request.path] ?? {
      code: 'http',
      kind: 'error' as const,
      message: 'fixture endpoint not defined',
      status: 404
    })
  }

  ;(window as unknown as { hermesDesktop?: unknown }).hermesDesktop = { enterprise: bridge }

  return bridge
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('EnterpriseClientApp authority lifecycle', () => {
  it('renders only the server-provided tenant identity through the token-free bridge', async () => {
    const bridge = installAuthorityBridge({
      '/api/health': { data: HEALTH, kind: 'ok' },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': { data: IDENTITY, kind: 'ok' }
    })

    render(<EnterpriseClientApp />)

    await screen.findAllByText('企业服务已连接')
    expect(screen.getAllByText('Lin Qiao')).toHaveLength(2)
    expect(screen.getAllByText('tenant-acme-logistics')).toHaveLength(2)
    expect(screen.getAllByText('员工')).toHaveLength(2)
    expect(bridge.autoConnect).toHaveBeenCalledWith()
    expect(bridge.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/whoami',
      sessionId: 'opaque-session'
    })
    expect(JSON.stringify(bridge.request.mock.calls)).not.toMatch(/token|bearer/i)
  })

  it('releases the opaque session and clears authority presentation after a 401', async () => {
    const bridge = installAuthorityBridge({
      '/api/health': { code: 'http', kind: 'error', message: 'request failed (401)', status: 401 },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': { data: IDENTITY, kind: 'ok' }
    })

    render(<EnterpriseClientApp />)

    expect(await screen.findByText('企业会话已失效，请重新连接')).toBeTruthy()
    await waitFor(() => expect(bridge.disconnect).toHaveBeenCalledWith('opaque-session'))
    expect(screen.queryByText('Lin Qiao')).toBeNull()
    expect(screen.getByTestId('enterprise-login-root')).toBeTruthy()
    expect(screen.getByText('登录企业账号')).toBeTruthy()
  })

  it('does not release a session for a 403 authority denial', async () => {
    const bridge = installAuthorityBridge({
      '/api/health': { data: HEALTH, kind: 'ok' },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': { code: 'http', kind: 'error', message: 'request failed (403)', status: 403 }
    })

    render(<EnterpriseClientApp />)

    expect(await screen.findByText('当前身份无权访问此资源')).toBeTruthy()
    expect(bridge.disconnect).not.toHaveBeenCalled()
  })
})
