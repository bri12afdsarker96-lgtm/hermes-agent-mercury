import { afterEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { $transport, BaseHermesTransport, getTransport, type TransportRequest } from './transport'

class SpyTransport extends BaseHermesTransport {
  readonly calls: Array<[string, TransportRequest | undefined]> = []

  request<T>(path: string, opts?: TransportRequest): Promise<T> {
    this.calls.push([path, opts])

    return Promise.resolve({ opts, path } as unknown as T)
  }
}

afterEach(() => {
  $transport.set(null)
})

describe('BaseHermesTransport', () => {
  it('derives get/post from request', async () => {
    const spy = new SpyTransport()
    await spy.get('/a')
    await spy.post('/b', { x: 1 })

    expect(spy.calls[0]).toEqual(['/a', undefined])
    expect(spy.calls[1]).toEqual(['/b', { body: { x: 1 }, method: 'POST' }])
  })
})

describe('getTransport', () => {
  it('throws when disconnected and returns the active transport when set', () => {
    expect(() => getTransport()).toThrow()

    const transport = new FakeHermesTransport({})
    $transport.set(transport)
    expect(getTransport()).toBe(transport)
  })
})

describe('FakeHermesTransport', () => {
  it('resolves canned responses by path prefix and rejects unknown paths', async () => {
    const transport = new FakeHermesTransport({
      '/api/health': { auth_mode: 'strict', ok: true }
    })

    await expect(transport.get('/api/health')).resolves.toEqual({ auth_mode: 'strict', ok: true })
    // Prefix match ignores the query string.
    await expect(transport.get('/api/health?x=1')).resolves.toMatchObject({ ok: true })
    await expect(transport.get('/api/unknown')).rejects.toMatchObject({ status: 404 })
  })
})
