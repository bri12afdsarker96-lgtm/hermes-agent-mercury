import { afterEach, describe, expect, it, vi } from 'vitest'

import { connectEnterpriseClient, EnterpriseClientError } from './runtime'

type EnterpriseResponse =
  { data: unknown; kind: 'ok' } | { code: string; kind: 'error'; message: string; status: number }

function installBridge(response: EnterpriseResponse = { data: { ok: true }, kind: 'ok' }) {
  const bridge = {
    autoConnect: vi.fn(async () => ({
      baseUrl: 'https://enterprise.example.com',
      ok: true as const,
      sessionId: 'opaque-session'
    })),
    disconnect: vi.fn(async () => ({ ok: true })),
    request: vi.fn(async () => response)
  }

  ;(window as unknown as { hermesDesktop?: unknown }).hermesDesktop = { enterprise: bridge }

  return bridge
}

afterEach(() => {
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('Enterprise client runtime adapter', () => {
  it('uses the token-free main bridge and fences requests with its opaque session', async () => {
    const bridge = installBridge({ data: { ok: true }, kind: 'ok' })
    const runtime = await connectEnterpriseClient()

    await expect(runtime.get('/api/health')).resolves.toEqual({ ok: true })
    expect(bridge.autoConnect).toHaveBeenCalledWith()
    expect(bridge.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/health',
      sessionId: 'opaque-session'
    })

    await expect(runtime.post!('/api/handoff-claim', { msg_id: 'handoff-1' })).resolves.toEqual({ ok: true })
    expect(bridge.request).toHaveBeenCalledWith({
      body: { msg_id: 'handoff-1' },
      method: 'POST',
      path: '/api/handoff-claim',
      sessionId: 'opaque-session'
    })

    await runtime.disconnect()
    expect(bridge.disconnect).toHaveBeenCalledWith('opaque-session')
  })

  it('fails closed when the bridge is missing or an API request is rejected', async () => {
    await expect(connectEnterpriseClient()).rejects.toBeInstanceOf(EnterpriseClientError)

    installBridge({ code: 'http', kind: 'error', message: 'request failed (403)', status: 403 })
    const runtime = await connectEnterpriseClient()

    await expect(runtime.get('/api/whoami')).rejects.toMatchObject({
      message: 'request failed (403)',
      name: 'EnterpriseClientError'
    })
  })
})
