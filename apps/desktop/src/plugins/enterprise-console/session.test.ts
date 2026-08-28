import type { PluginStorage } from '@hermes/plugin-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FetchHermesTransport } from './fetch-transport'
import {
  $baseUrl,
  $connectError,
  $sessionState,
  $whoami,
  autoConnect,
  bindSession,
  connect,
  disconnect,
  setAutoTransportFactory,
  setTransportFactory
} from './session'
import { $transport, UnavailableHermesTransport } from './transport'
import type { Whoami } from './types'

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
})
