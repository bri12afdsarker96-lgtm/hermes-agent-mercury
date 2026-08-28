import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasIpcBridge, IpcHermesTransport } from './ipc-transport'

type EnterpriseResult = { data: unknown; kind: 'ok' } | { code: string; kind: 'error'; message: string; status: number }

type WindowWithBridge = {
  hermesDesktop?: {
    enterprise: {
      connect: (baseUrl: string, token: string) => Promise<{ ok: boolean; sessionId: string }>
      disconnect: (sessionId: string) => Promise<{ ok: boolean }>
      request: (req: { body?: unknown; method?: string; path: string; sessionId: string }) => Promise<EnterpriseResult>
      upload: (req: {
        bytes: ArrayBuffer
        contentType: string
        filename: string
        path: string
        sessionId: string
      }) => Promise<EnterpriseResult>
    }
  }
}

function makeBridge(result: EnterpriseResult = { data: { ok: true }, kind: 'ok' }) {
  const bridge = {
    connect: vi.fn(async () => ({ ok: true, sessionId: 'sid-1' })),
    disconnect: vi.fn(async () => ({ ok: true })),
    request: vi.fn(async () => result),
    upload: vi.fn(async () => result)
  }

  ;(window as unknown as WindowWithBridge).hermesDesktop = { enterprise: bridge }

  return bridge
}

afterEach(() => {
  delete (window as unknown as WindowWithBridge).hermesDesktop
})

describe('hasIpcBridge', () => {
  it('reflects whether the desktop bridge is present', () => {
    expect(hasIpcBridge()).toBe(false)
    makeBridge()
    expect(hasIpcBridge()).toBe(true)
  })
})

describe('IpcHermesTransport', () => {
  it('ships the bearer to main once and fences requests by the returned sessionId', async () => {
    const bridge = makeBridge()

    const transport = new IpcHermesTransport('http://h:1', 'secret-bearer')
    await transport.get('/api/whoami')

    expect(bridge.connect).toHaveBeenCalledWith('http://h:1', 'secret-bearer')
    // The request carries the opaque sessionId, never the token.
    expect(bridge.request).toHaveBeenCalledWith({
      body: undefined,
      method: undefined,
      path: '/api/whoami',
      sessionId: 'sid-1'
    })
    expect(JSON.stringify(transport)).not.toContain('secret-bearer')
    expect(Object.keys(transport)).not.toContain('token')
  })

  it('returns data on ok and maps error results to HermesApiError codes', async () => {
    makeBridge({ data: { ok: true }, kind: 'ok' })
    const okTransport = new IpcHermesTransport('http://h:1', 't')
    await expect(okTransport.get('/api/health')).resolves.toEqual({ ok: true })

    makeBridge({ code: 'http', kind: 'error', message: 'request failed (401)', status: 401 })
    const errTransport = new IpcHermesTransport('http://h:1', 't')
    await expect(errTransport.get('/api/whoami')).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('clears exactly its session on dispose (fenced by sessionId)', async () => {
    const bridge = makeBridge()
    const transport = new IpcHermesTransport('http://h:1', 't')
    // Let the connect handshake resolve so dispose has the sessionId.
    await transport.get('/api/health')
    transport.dispose()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(bridge.disconnect).toHaveBeenCalledWith('sid-1')
  })

  it('fails closed (throws) when the desktop bridge is absent', () => {
    expect(() => new IpcHermesTransport('http://h:1', 't')).toThrow()
  })
})

describe('IpcHermesTransport.upload', () => {
  it('sends the file to main fenced by sessionId, never holding it in the renderer', async () => {
    const bridge = makeBridge({ data: { upload_id: 'u1' }, kind: 'ok' })
    const transport = new IpcHermesTransport('http://h:1', 'secret-bearer')
    const bytes = new Uint8Array([1, 2, 3]).buffer

    await expect(
      transport.upload('/api/knowledge-upload', { bytes, contentType: 'text/plain', filename: 'x.txt' })
    ).resolves.toEqual({ upload_id: 'u1' })

    expect(bridge.upload).toHaveBeenCalledWith({
      bytes,
      contentType: 'text/plain',
      filename: 'x.txt',
      path: '/api/knowledge-upload',
      sessionId: 'sid-1'
    })
  })
})
