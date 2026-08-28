import { afterEach, describe, expect, it, vi } from 'vitest'

import { HermesApiError, rawRequest } from './hermes-client'

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rawRequest', () => {
  it('parses JSON, trims the base URL, and sends a bearer when given', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const data = await rawRequest<{ ok: boolean }>('http://h:1/', '/api/whoami', { token: 'secret-bearer' })

    expect(data).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://h:1/api/whoami')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-bearer')
  })

  it('omits Authorization for unauthenticated routes', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await rawRequest('http://h:1', '/api/health')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect('Authorization' in (init.headers as Record<string, string>)).toBe(false)
  })

  it('maps 401 / 403 / 501 to coded errors', async () => {
    const cases: Array<[number, string]> = [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [501, 'not_implemented']
    ]

    for (const [status, code] of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => fakeResponse(status, { error: 'nope' }))
      )
      await expect(rawRequest('http://h:1', '/api/x')).rejects.toMatchObject({ code, status })
    }
  })

  it('never leaks the bearer or URL in a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect http://h:1?token=secret-bearer failed')
      })
    )

    const err = await rawRequest('http://h:1', '/api/x', { token: 'secret-bearer' }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(HermesApiError)
    expect((err as HermesApiError).code).toBe('network')
    expect((err as HermesApiError).message).not.toContain('secret-bearer')
  })

  it('fails closed when no endpoint is configured', async () => {
    await expect(rawRequest('   ', '/api/x')).rejects.toBeInstanceOf(HermesApiError)
  })
})
