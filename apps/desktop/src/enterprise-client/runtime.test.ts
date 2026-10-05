import { afterEach, describe, expect, it, vi } from 'vitest'

import { assistantChoiceRequest, assistantChoicesMatch, assistantRequestError, EnterpriseAssistantRequestUnknown, EnterpriseClientError, beginEnterpriseLogin, beginEnterprisePasswordLogin, connectEnterpriseClient, type EnterpriseAssistantBackendChoice } from './runtime'

type EnterpriseResponse =
  { data: unknown; kind: 'ok' } | { code: string; kind: 'error'; message: string; status: number }

describe('Assistant backend assertions', () => {
  const choice: EnterpriseAssistantBackendChoice = { backend_id: 'tenant_model', configuration_id: 'owned', configuration_version: 7,
    model: 'model', runtime_protocol: 'openai_chat_completions', reasoning_effort: null, availability: 'available' }
  it('transmits public assertions and compares every bound setting', () => {
    const request = assistantChoiceRequest({ ...choice, api_key: 'private' } as EnterpriseAssistantBackendChoice)
    expect(request).not.toHaveProperty('api_key')
    expect(request.configuration_id).toBe(choice.configuration_id)
    expect(assistantChoicesMatch(choice, { ...choice })).toBe(true)
    for (const patch of [{ model: 'other' }, { configuration_version: 8 }, { configuration_id: 'foreign' }, { runtime_protocol: 'other' }]) {
      expect(assistantChoicesMatch(choice, { ...choice, ...patch })).toBe(false)
    }
  })
  it('sanitizes definitive rejection and treats transport or 5xx as unknown', () => {
    const denied = assistantRequestError(new EnterpriseClientError(403, { kind: 'forbidden', message: 'private provider path' }))
    expect(denied.message).not.toContain('private')
    expect(denied).not.toBeInstanceOf(EnterpriseAssistantRequestUnknown)
    for (const failure of [new Error('private token'), new EnterpriseClientError(503, { kind: 'authority_unavailable', message: 'private' })]) {
      expect(assistantRequestError(failure)).toBeInstanceOf(EnterpriseAssistantRequestUnknown)
    }
  })
})

function installBridge(response: EnterpriseResponse = { data: { ok: true }, kind: 'ok' }) {
  const bridge = {
    autoConnect: vi.fn(async () => ({
      baseUrl: 'https://enterprise.example.com',
      ok: true as const,
      sessionId: 'opaque-session'
    })),
    beginLogin: vi.fn(async () => ({ ok: true as const })),
    disconnect: vi.fn(async () => ({ ok: true })),
    request: vi.fn(async () => response),
    upload: vi.fn(async () => response)
  }

  ;(window as unknown as { hermesDesktop?: unknown }).hermesDesktop = { enterprise: bridge }

  return bridge
}

afterEach(() => {
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('Enterprise client runtime adapter', () => {
  it('retries transient reads once but never replays writes', async () => {
    const bridge = installBridge()
    const failure = { code: 'http', kind: 'error' as const, message: 'unavailable', status: 503 }
    bridge.request.mockResolvedValueOnce(failure)
    const runtime = await connectEnterpriseClient()
    await expect(runtime.get('/api/whoami')).resolves.toEqual({ ok: true })
    expect(bridge.request).toHaveBeenCalledTimes(2)
    bridge.request.mockClear().mockResolvedValueOnce(failure)
    await expect(runtime.post!('/api/assistant-reminder-action', { action: 'create' })).rejects.toMatchObject({ status: 503 })
    expect(bridge.request).toHaveBeenCalledOnce()
  })
  it('uses bounded backoff for repeated transient reads', async () => {
    vi.useFakeTimers()

    try {
      const bridge = installBridge()
      const failure = { code: 'http', kind: 'error' as const, message: 'unavailable', status: 503 }
      bridge.request.mockResolvedValueOnce(failure).mockResolvedValueOnce(failure)
      const runtime = await connectEnterpriseClient()
      const request = runtime.get('/api/whoami')

      await vi.advanceTimersByTimeAsync(1_500)
      await expect(request).resolves.toEqual({ ok: true })
      expect(bridge.request).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
  it.each([
    ['invalid_credentials', 'invalid_credentials', 403],
    ['service_unavailable', 'authority_unavailable', 503],
    ['rate_limited', 'rate_limited', 429],
    ['network', 'network', 0]
  ])('preserves password login failure category %s without exposing server text', async (code, kind, status) => {
    const bridge = installBridge()
    Object.assign(bridge, { loginWithPassword: vi.fn(async () => ({ ok: false, code, message: 'sensitive server detail' })) })
    await expect(beginEnterprisePasswordLogin('test.account', 'a-valid-password')).rejects.toMatchObject({ kind, status })
    await expect(beginEnterprisePasswordLogin('test.account', 'a-valid-password')).rejects.not.toHaveProperty('message', 'sensitive server detail')
  })
  it('distinguishes main-owned no-session from configuration and transport failures', async () => {
    const bridge = installBridge()
    bridge.autoConnect.mockResolvedValueOnce({ ok: false, code: 'no_native_session', message: 'internal' } as never)
    await expect(connectEnterpriseClient()).rejects.toMatchObject({ name: 'EnterpriseLoginRequired', message: '请登录企业账号' })
    expect(bridge.request).not.toHaveBeenCalled()
    bridge.autoConnect.mockResolvedValueOnce({ ok: false, code: 'no_enterprise_origin', message: 'internal' } as never)
    await expect(connectEnterpriseClient()).rejects.toMatchObject({ name: 'EnterpriseClientError', kind: 'network' })
    bridge.autoConnect.mockRejectedValueOnce(new Error('bridge offline'))
    await expect(connectEnterpriseClient()).rejects.toMatchObject({ name: 'EnterpriseClientError', kind: 'network' })
  })

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

    const bytes = new Uint8Array([72, 101, 114, 109, 101, 115]).buffer
    await expect(runtime.upload!('/api/knowledge-upload', {
      bytes,
      contentType: 'text/plain',
      filename: 'readme.txt'
    })).resolves.toEqual({ ok: true })
    expect(bridge.upload).toHaveBeenCalledWith({
      bytes,
      contentType: 'text/plain',
      filename: 'readme.txt',
      path: '/api/knowledge-upload',
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

  it('reports only an explicit 401 to the shell session owner', async () => {
    const onAuthenticationRequired = vi.fn()
    const bridge = installBridge({ code: 'http', kind: 'error', message: 'request failed (401)', status: 401 })
    const runtime = await connectEnterpriseClient({ onAuthenticationRequired })

    await expect(runtime.get('/api/whoami')).rejects.toMatchObject({ kind: 'authentication_required', status: 401 })
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1)
    expect(onAuthenticationRequired).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'authentication_required', status: 401 })
    )

    bridge.request.mockResolvedValueOnce({ code: 'http', kind: 'error', message: 'request failed (403)', status: 403 })
    await expect(runtime.get('/api/audit-list')).rejects.toMatchObject({ kind: 'forbidden', status: 403 })
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1)
  })

  it('classifies a bridge transport failure without exposing its implementation detail', async () => {
    const bridge = installBridge()
    bridge.request.mockRejectedValue(new Error('https://internal.example.invalid: connection refused'))
    const runtime = await connectEnterpriseClient()

    await expect(runtime.get('/api/health')).rejects.toMatchObject({
      kind: 'network',
      message: '无法连接企业服务，请检查网络后重试',
      name: 'EnterpriseClientError',
      status: 0
    })
  })

  it.each(['get', 'post', 'upload'] as const)('does not let a disconnected %s request expire a later login', async method => {
    const bridge = installBridge()
    const onAuthenticationRequired = vi.fn()
    let resolve!: (response: EnterpriseResponse) => void
    const reply = new Promise<EnterpriseResponse>(done => { resolve = done })

    if (method === 'upload') {
      bridge.upload.mockReturnValueOnce(reply)
    } else {
      bridge.request.mockReturnValueOnce(reply)
    }

    const oldRuntime = await connectEnterpriseClient({ onAuthenticationRequired })

    const pending = method === 'get' ? oldRuntime.get('/api/whoami')
      : method === 'post' ? oldRuntime.post!('/api/tenant-ai-assist', { content: '旧客户上下文' })
        : oldRuntime.upload!('/api/knowledge-upload', { bytes: new ArrayBuffer(1), contentType: 'text/plain', filename: 'notes.txt' })

    await oldRuntime.disconnect()
    const newRuntime = await connectEnterpriseClient({ onAuthenticationRequired })
    resolve({ code: 'http', kind: 'error', message: 'expired old session', status: 401 })
    await expect(pending).rejects.toMatchObject({ kind: 'authentication_required' })
    expect(onAuthenticationRequired).not.toHaveBeenCalled()
    await expect(newRuntime.get('/api/health')).resolves.toEqual({ ok: true })
  })

  it('rejects new requests after disconnect without crossing the bridge', async () => {
    const bridge = installBridge()
    const runtime = await connectEnterpriseClient()
    await runtime.disconnect()
    await expect(runtime.post!('/api/tenant-ai-assist', { content: '不得继续发出' })).rejects.toBeInstanceOf(Error)
    expect(bridge.request).not.toHaveBeenCalled()
  })
})
