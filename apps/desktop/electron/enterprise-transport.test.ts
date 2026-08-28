import { describe, expect, it } from 'vitest'

import {
  EnterpriseSessionStore,
  isAllowedEnterpriseMethod,
  isValidEnterprisePath,
  normalizeEnterpriseBaseUrl,
  resolveEnterpriseUrl
} from './enterprise-transport'

describe('normalizeEnterpriseBaseUrl', () => {
  it('accepts loopback over http and any host over https', () => {
    expect(normalizeEnterpriseBaseUrl('http://localhost:8765')).toBe('http://localhost:8765')
    expect(normalizeEnterpriseBaseUrl('http://127.0.0.1:8765/')).toBe('http://127.0.0.1:8765')
    expect(normalizeEnterpriseBaseUrl('https://hermes.example.com')).toBe('https://hermes.example.com')
  })

  it('drops query/hash (they must not be authority routing input)', () => {
    expect(normalizeEnterpriseBaseUrl('https://h.example.com/base?x=1#f')).toBe('https://h.example.com/base')
  })

  it('rejects non-loopback http, embedded credentials, and non-http(s) schemes', () => {
    expect(() => normalizeEnterpriseBaseUrl('http://hermes.example.com')).toThrow()
    expect(() => normalizeEnterpriseBaseUrl('https://user:pass@h.example.com')).toThrow()
    expect(() => normalizeEnterpriseBaseUrl('ftp://h.example.com')).toThrow()
    expect(() => normalizeEnterpriseBaseUrl('')).toThrow()
  })
})

describe('isValidEnterprisePath', () => {
  it('accepts the /api/* surface', () => {
    expect(isValidEnterprisePath('/api/whoami')).toBe(true)
    expect(isValidEnterprisePath('/api/metrics?window=24h')).toBe(true)
  })

  it('rejects traversal (raw, encoded, backslash), scheme-relative, non-api, and control chars', () => {
    expect(isValidEnterprisePath('/api/../secrets')).toBe(false)
    expect(isValidEnterprisePath('/api/%2e%2e/secrets')).toBe(false)
    expect(isValidEnterprisePath('/api/x%2fy')).toBe(false)
    expect(isValidEnterprisePath('/api/x\\y')).toBe(false)
    expect(isValidEnterprisePath('//evil.example.com')).toBe(false)
    expect(isValidEnterprisePath('/notapi/x')).toBe(false)
    expect(isValidEnterprisePath(`/api/${String.fromCharCode(1)}`)).toBe(false)
    expect(isValidEnterprisePath(42)).toBe(false)
  })
})

describe('isAllowedEnterpriseMethod', () => {
  it('allows only GET and POST for Phase-1', () => {
    expect(isAllowedEnterpriseMethod('GET')).toBe(true)
    expect(isAllowedEnterpriseMethod('post')).toBe(true)
    expect(isAllowedEnterpriseMethod('DELETE')).toBe(false)
    expect(isAllowedEnterpriseMethod('PUT')).toBe(false)
    expect(isAllowedEnterpriseMethod('')).toBe(false)
  })
})

describe('resolveEnterpriseUrl', () => {
  it('resolves an on-origin /api url, honouring a reverse-proxy path prefix', () => {
    expect(resolveEnterpriseUrl('https://h.example.com', '/api/x')).toBe('https://h.example.com/api/x')
    expect(resolveEnterpriseUrl('https://h.example.com/hermes', '/api/x')).toBe('https://h.example.com/hermes/api/x')
  })

  it('rejects an invalid path', () => {
    expect(() => resolveEnterpriseUrl('https://h.example.com', '/api/../x')).toThrow()
  })
})

describe('EnterpriseSessionStore — per-renderer fencing', () => {
  const BASE = 'https://h.example.com'

  it('resolves only with the matching sender AND sessionId', () => {
    const store = new EnterpriseSessionStore()
    const sid = store.connect(1, BASE, 'tok-a')

    expect(store.resolve(1, sid)?.token).toBe('tok-a')
    expect(store.resolve(1, 'wrong')).toBeNull()
    expect(store.resolve(2, sid)).toBeNull() // different renderer cannot use it
  })

  it('isolates two windows (no cross-window bleed)', () => {
    const store = new EnterpriseSessionStore()
    const sidA = store.connect(1, BASE, 'tok-a')
    const sidB = store.connect(2, BASE, 'tok-b')

    expect(store.resolve(1, sidA)?.token).toBe('tok-a')
    expect(store.resolve(2, sidB)?.token).toBe('tok-b')
    // B connecting did not disturb A.
    expect(store.resolve(1, sidA)?.token).toBe('tok-a')
  })

  it('fences stale sessions: a superseded sessionId cannot read or tear down the new one', () => {
    const store = new EnterpriseSessionStore()
    const sidA = store.connect(1, BASE, 'tok-a')
    const sidB = store.connect(1, BASE, 'tok-b') // same sender reconnects

    expect(store.resolve(1, sidA)).toBeNull() // stale request cannot borrow tok-b
    expect(store.disconnect(1, sidA)).toBe(false) // stale disconnect cannot kill new session
    expect(store.resolve(1, sidB)?.token).toBe('tok-b')
  })

  it('disconnect clears only the exact matching session', () => {
    const store = new EnterpriseSessionStore()
    const sid = store.connect(1, BASE, 'tok-a')

    expect(store.disconnect(1, sid)).toBe(true)
    expect(store.resolve(1, sid)).toBeNull()
    expect(store.size()).toBe(0)
  })

  it('destroySender removes the orphan bearer when a window closes', () => {
    const store = new EnterpriseSessionStore()
    const sid = store.connect(1, BASE, 'tok-a')

    store.destroySender(1)
    expect(store.resolve(1, sid)).toBeNull()
    expect(store.size()).toBe(0)
  })

  it('rejects a missing token and an invalid base URL', () => {
    const store = new EnterpriseSessionStore()

    expect(() => store.connect(1, BASE, '')).toThrow()
    expect(() => store.connect(1, 'http://remote.example.com', 'tok')).toThrow()
  })
})
