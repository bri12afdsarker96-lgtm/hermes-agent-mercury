import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasIpcBridge, IpcHermesTransport } from './ipc-transport'

type EnterpriseResult = { data: unknown; kind: 'ok' } | { code: string; kind: 'error'; message: string; status: number }

type WindowWithBridge = {
  hermesDesktop?: {
    enterprise: {
      connect: (baseUrl: string, token: string) => Promise<{ ok: boolean }>
      disconnect: () => Promise<{ ok: boolean }>
      request: (req: { body?: unknown; method?: string; path: string }) => Promise<EnterpriseResult>
    }
  }
}

function makeBridge(result: EnterpriseResult = { data: { ok: true }, kind: 'ok' }) {
  const bridge = {
    connect: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn(async () => ({ ok: true })),
    request: vi.fn(async () => result)
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
  it('ships the bearer to main once and never holds it in the renderer', async () => {
    const bridge = makeBridge()

    const transport = new IpcHermesTransport('http://h:1', 'secret-bearer')
    await transport.get('/api/whoami')

    expect(bridge.connect).toHaveBeenCalledWith('http://h:1', 'secret-bearer')
    // The request payload never carries the token.
    expect(bridge.request).toHaveBeenCalledWith({ body: undefined, method: undefined, path: '/api/whoami' })
    // The transport object exposes no bearer.
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

  it('clears the main-process session on dispose', () => {
    const bridge = makeBridge()
    const transport = new IpcHermesTransport('http://h:1', 't')
    transport.dispose()
    expect(bridge.disconnect).toHaveBeenCalled()
  })
})
