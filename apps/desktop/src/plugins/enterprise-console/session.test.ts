import type { PluginStorage } from '@hermes/plugin-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FetchHermesTransport, HermesApiError } from './fetch-transport'
import {
  $baseUrl,
  $connectError,
  $sessionState,
  $whoami,
  autoConnect,
  bindSession,
  connect,
  disconnect,
  refreshWhoami,
  setAutoTransportFactory,
  setTransportFactory
} from './session'
import { $transport, BaseHermesTransport, type TransportRequest, UnavailableHermesTransport } from './transport'
import type { Whoami } from './types'

/** A transport whose every request rejects with a fixed error (FSM tests). */
class RejectingTransport extends BaseHermesTransport {
  disposed = false

  constructor(private readonly err: unknown) {
    super()
  }

  dispose(): void {
    this.disposed = true
  }

  request<T>(_path: string, _opts?: TransportRequest): Promise<T> {
    return Promise.reject(this.err)
  }
}

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  } as unknown as Response
}

const WHO: Whoami = {
  capability_revision: 3,
  data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
  name: 'alice',
  principal_id: 'p1',
  product_capabilities: {},
  role: 'tenant_admin',
  tenant_id: 't1'
}

function makeStorage() {
  const store = new Map<string, unknown>()
  const sets: Array<{ key: string; value: unknown }> = []

  const storage: PluginStorage = {
    get: <T>(key: string, fallback: T): T => (store.has(key) ? (store.get(key) as T) : fallback),
    remove: (key: string) => void store.delete(key),
    set: (key: string, value: unknown) => {
      sets.push({ key, value })
      store.set(key, value)
    }
  }

  return { sets, storage }
}

beforeEach(() => {
  $baseUrl.set('')
  $whoami.set(null)
  $connectError.set(null)
  $transport.set(null)
  $sessionState.set('UNKNOWN')
  // The production default fails closed; tests inject a transport explicitly.
  setTransportFactory((baseUrl, token) => new FetchHermesTransport(baseUrl, token))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bindSession', () => {
  it('persists only the base URL, never the bearer or identity', async () => {
    const { sets, storage } = makeStorage()
    const dispose = bindSession(storage)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(200, WHO))
    )
    await connect('http://h:1', 'secret-bearer')

    // Only the base URL is ever written to storage — the bearer never is.
    expect(sets.every(s => s.key === 'hermesBaseUrl')).toBe(true)
    expect(JSON.stringify(sets)).not.toContain('secret-bearer')

    dispose()
    // The disposer drops the transport (its credential) + identity.
    expect($transport.get()).toBeNull()
    expect($whoami.get()).toBeNull()
  })
})

describe('connect', () => {
  it('lets the server establish the session (whoami) and installs a transport', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(200, WHO))
    )

    await connect('http://h:1/', 'secret-bearer')

    expect($whoami.get()).toEqual(WHO)
    expect($transport.get()).not.toBeNull()
    expect($baseUrl.get()).toBe('http://h:1')
    // The token is not reachable through any exported session atom.
    expect(JSON.stringify($transport.get())).not.toContain('secret-bearer')
  })

  it('fails closed on auth failure — no transport, no identity, redacted error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(401, { error: 'login failed' }))
    )

    await expect(connect('http://h:1', 'secret-bearer')).rejects.toBeTruthy()

    expect($transport.get()).toBeNull()
    expect($whoami.get()).toBeNull()
    expect($connectError.get()).not.toBeNull()
    expect($connectError.get()).not.toContain('secret-bearer')
  })
})

describe('disconnect', () => {
  it('clears the transport and identity', () => {
    $whoami.set(WHO)
    disconnect()
    expect($transport.get()).toBeNull()
    expect($whoami.get()).toBeNull()
  })
})

describe('fail-closed default transport', () => {
  it('cannot connect when no real transport is installed', async () => {
    setTransportFactory(() => new UnavailableHermesTransport())

    await expect(connect('http://h:1', 'secret-bearer')).rejects.toBeTruthy()
    expect($transport.get()).toBeNull()
    expect($whoami.get()).toBeNull()
  })
})

describe('autoConnect — B16-OL one-login FSM', () => {
  beforeEach(() => {
    // token-free auto transport (main holds the bearer in production).
    setAutoTransportFactory(() => new FetchHermesTransport('http://h:1', ''))
  })

  it('AUTHENTICATED on a real whoami; sets $whoami; returns true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200, WHO)))
    const ok = await autoConnect()
    expect(ok).toBe(true)
    expect($sessionState.get()).toBe('AUTHENTICATED')
    expect($whoami.get()).toEqual(WHO)
    expect($transport.get()).not.toBeNull()
  })

  it('UNAVAILABLE (NOT REVOKED) on a 5xx outage; returns false; never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(503, { error: 'down' })))
    await expect(autoConnect()).resolves.toBe(false)
    expect($sessionState.get()).toBe('UNAVAILABLE')
    expect($sessionState.get()).not.toBe('REVOKED')
    expect($whoami.get()).toBeNull()
    expect($transport.get()).toBeNull()
  })

  it('UNAVAILABLE on a network error; never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(autoConnect()).resolves.toBe(false)
    expect($sessionState.get()).toBe('UNAVAILABLE')
  })

  it('REVOKED on 401/403 from the federated authority', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(403, { error: 'revoked' })))
    const ok = await autoConnect()
    expect(ok).toBe(false)
    expect($sessionState.get()).toBe('REVOKED')
    expect($whoami.get()).toBeNull()
  })

  it('a failed probe never transitions through AUTHENTICATED', async () => {
    const seen: string[] = []
    const unsub = $sessionState.subscribe(s => seen.push(s))
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(503, {})))
    await autoConnect()
    unsub()
    expect(seen).not.toContain('AUTHENTICATED')
  })

  // §13 — a missing native session is UNKNOWN (not-yet-eligible), never a fake
  // AUTHENTICATED and never a spurious UNAVAILABLE outage.
  it('no_native_session maps to UNKNOWN (not UNAVAILABLE)', async () => {
    setAutoTransportFactory(() => new RejectingTransport(new HermesApiError(0, 'no_native_session', 'no authenticated native session')))
    const ok = await autoConnect()
    expect(ok).toBe(false)
    expect($sessionState.get()).toBe('UNKNOWN')
    expect($whoami.get()).toBeNull()
  })

  // A coarse 'error' (e.g. no_enterprise_origin, forwarded as 'error') stays
  // UNAVAILABLE — config-absent is "unavailable", not "no session".
  it('a coarse error (e.g. no_enterprise_origin) stays UNAVAILABLE', async () => {
    setAutoTransportFactory(() => new RejectingTransport(new HermesApiError(0, 'error', 'enterprise API origin is not configured')))
    await autoConnect()
    expect($sessionState.get()).toBe('UNAVAILABLE')
  })
})

describe('refreshWhoami — B-OL-FSM-MEDIUM-01', () => {
  // §12 — a transient failure must drop to UNAVAILABLE so $enterpriseAvailable
  // flips false; the transport stays alive so recovery can reuse it.
  it('AUTHENTICATED → UNAVAILABLE on a transient outage, keeping the transport', async () => {
    const transport = new RejectingTransport(new HermesApiError(503, 'error', 'down'))
    $transport.set(transport)
    $whoami.set(WHO)
    $sessionState.set('AUTHENTICATED')

    await refreshWhoami()

    expect($sessionState.get()).toBe('UNAVAILABLE')
    expect($transport.get()).toBe(transport)
    expect(transport.disposed).toBe(false)
  })

  it('AUTHENTICATED → REVOKED on 401/403, disposing the transport', async () => {
    const transport = new RejectingTransport(new HermesApiError(403, 'forbidden', 'revoked'))
    $transport.set(transport)
    $whoami.set(WHO)
    $sessionState.set('AUTHENTICATED')

    await refreshWhoami()

    expect($sessionState.get()).toBe('REVOKED')
    expect($transport.get()).toBeNull()
    expect(transport.disposed).toBe(true)
  })

  // §10-B recovery: a later successful whoami on the live transport returns to
  // AUTHENTICATED without an app restart.
  it('UNAVAILABLE → AUTHENTICATED when whoami recovers on the live transport', async () => {
    let calls = 0

    class Recovering extends BaseHermesTransport {
      request<T>(): Promise<T> {
        calls += 1

        if (calls === 1) {
          return Promise.reject(new HermesApiError(503, 'error', 'down'))
        }

        return Promise.resolve(WHO as T)
      }
    }
    const transport = new Recovering()
    $transport.set(transport)
    $whoami.set(WHO)
    $sessionState.set('AUTHENTICATED')

    await refreshWhoami()
    expect($sessionState.get()).toBe('UNAVAILABLE')

    await refreshWhoami()
    expect($sessionState.get()).toBe('AUTHENTICATED')
    expect($whoami.get()).toEqual(WHO)
  })
})
