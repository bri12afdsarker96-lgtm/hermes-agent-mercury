import type { PluginStorage } from '@hermes/plugin-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $baseUrl, $connectError, $token, $whoami, bindSession, connect, disconnect } from './session'
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
  $token.set(null)
  $whoami.set(null)
  $connectError.set(null)
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

    // Only the base URL is ever written to storage.
    expect(sets.every(s => s.key === 'hermesBaseUrl')).toBe(true)
    expect(sets.some(s => s.value === 'secret-bearer')).toBe(false)
    expect(JSON.stringify(sets)).not.toContain('secret-bearer')

    dispose()
    // The disposer wipes the in-memory secret + identity.
    expect($token.get()).toBeNull()
    expect($whoami.get()).toBeNull()
  })
})

describe('connect', () => {
  it('lets the server establish the session (whoami) and holds the bearer in memory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(200, WHO))
    )

    await connect('http://h:1/', 'secret-bearer')

    expect($whoami.get()).toEqual(WHO)
    expect($token.get()).toBe('secret-bearer')
    expect($baseUrl.get()).toBe('http://h:1')
  })

  it('fails closed on auth failure — no token, no identity, redacted error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(401, { error: 'login failed' }))
    )

    await expect(connect('http://h:1', 'secret-bearer')).rejects.toBeTruthy()

    expect($token.get()).toBeNull()
    expect($whoami.get()).toBeNull()
    expect($connectError.get()).not.toBeNull()
    expect($connectError.get()).not.toContain('secret-bearer')
  })
})

describe('disconnect', () => {
  it('wipes the in-memory session', () => {
    $token.set('t')
    $whoami.set(WHO)
    disconnect()
    expect($token.get()).toBeNull()
    expect($whoami.get()).toBeNull()
  })
})
