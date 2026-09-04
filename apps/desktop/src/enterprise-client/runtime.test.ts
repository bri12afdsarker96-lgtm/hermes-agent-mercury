import { afterEach, describe, expect, it, vi } from 'vitest'

import { beginEnterpriseLogin, connectEnterpriseClient } from './runtime'

type EnterpriseResponse =
  { data: unknown; kind: 'ok' } | { code: string; kind: 'error'; message: string; status: number }

function installBridge(response: EnterpriseResponse = { data: { ok: true }, kind: 'ok' }) {
  const bridge = {
    autoConnect: vi.fn(async () => ({
      baseUrl: 'https://enterprise.example.com',
      ok: true as const,
      sessionId: 'opaque-session'
    })),
    beginLogin: vi.fn(async () => ({ ok: true as const })),
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
  it('starts login only through the token-free main bridge', async () => {
    const bridge = installBridge()

    await expect(beginEnterpriseLogin()).resolves.toEqual({ ok: true })
    expect(bridge.beginLogin).toHaveBeenCalledWith()
  })

  it('fails closed when the login bridge is unavailable', async () => {
    await expect(beginEnterpriseLogin()).resolves.toMatchObject({
      code: 'bridge_unavailable',
      ok: false
    })
  })

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
    await expect(connectEnterpriseClient()).rejects.toMatchObject({
      kind: 'network',
      name: 'EnterpriseClientError',
      status: 0
    })

    installBridge({ code: 'http', kind: 'error', message: 'request failed (403)', status: 403 })
    const runtime = await connectEnterpriseClient()

    await expect(runtime.get('/api/whoami')).rejects.toMatchObject({
      kind: 'forbidden',
      message: '当前身份无权访问此资源',
      name: 'EnterpriseClientError',
      status: 403
    })
  })

  it.each([
    [401, 'authentication_required', '企业会话已失效，请重新连接'],
    [403, 'forbidden', '当前身份无权访问此资源'],
    [404, 'not_found', '当前范围内没有可用资源'],
    [409, 'conflict', '服务端状态已变化，请刷新后重试'],
    [503, 'authority_unavailable', '企业服务暂时不可用，请稍后重试']
  ] as const)('maps HTTP %i to a safe %s runtime error', async (status, kind, message) => {
    installBridge({ code: 'server-detail', kind: 'error', message: 'sensitive server detail', status })
    const runtime = await connectEnterpriseClient()

    await expect(runtime.get('/api/whoami')).rejects.toMatchObject({
      kind,
      message,
      name: 'EnterpriseClientError',
      status
    })
  })

  it('classifies a bridge transport failure without exposing its implementation detail', async () => {
    const bridge = installBridge()
    bridge.request.mockRejectedValueOnce(new Error('https://internal.example.invalid: connection refused'))
    const runtime = await connectEnterpriseClient()

    await expect(runtime.get('/api/health')).rejects.toMatchObject({
      kind: 'network',
      message: '无法连接企业服务，请检查网络后重试',
      name: 'EnterpriseClientError',
      status: 0
    })
  })
})
