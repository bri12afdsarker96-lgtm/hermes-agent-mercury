import { describe, expect, it } from 'vitest'

import {
  buildAutoConnectResult,
  classifyConnectError,
  ENTERPRISE_MAX_UPLOAD_BYTES,
  EnterpriseSessionStore,
  isAllowedEnterpriseMethod,
  isValidEnterprisePath,
  normalizeEnterpriseApiOriginOrNull,
  normalizeEnterpriseBaseUrl,
  resolveEnterpriseUrl,
  sanitizeMultipartContentType,
  uploadByteLength
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

// --- B16-B security hardening -------------------------------------------------

describe('sanitizeMultipartContentType (M1 — multipart header injection)', () => {
  const CR = String.fromCharCode(13)
  const LF = String.fromCharCode(10)
  const NUL = String.fromCharCode(0)

  it('rejects a CRLF-injection attempt (falls back to the safe default)', () => {
    const injected = `text/plain${CR}${LF}X-Injected: 1${CR}${LF}Content-Disposition: form-data; name="collection"`
    expect(sanitizeMultipartContentType(injected)).toBe('application/octet-stream')
  })

  it('rejects a bare CR, a bare LF, and a NUL byte', () => {
    expect(sanitizeMultipartContentType(`text/plain${CR}`)).toBe('application/octet-stream')
    expect(sanitizeMultipartContentType(`text/plain${LF}evil`)).toBe('application/octet-stream')
    expect(sanitizeMultipartContentType(`text/plain${NUL}`)).toBe('application/octet-stream')
  })

  it('rejects a malformed MIME essence and non-string input', () => {
    expect(sanitizeMultipartContentType('not a mime type')).toBe('application/octet-stream')
    expect(sanitizeMultipartContentType('../../evil')).toBe('application/octet-stream')
    expect(sanitizeMultipartContentType('text/')).toBe('application/octet-stream')
    expect(sanitizeMultipartContentType(42)).toBe('application/octet-stream')
    expect(sanitizeMultipartContentType(null)).toBe('application/octet-stream')
  })

  it('passes a well-formed MIME essence (dropping parameters, normalising case)', () => {
    expect(sanitizeMultipartContentType('text/plain')).toBe('text/plain')
    expect(sanitizeMultipartContentType('application/pdf')).toBe('application/pdf')
    expect(sanitizeMultipartContentType('image/svg+xml')).toBe('image/svg+xml')
    expect(sanitizeMultipartContentType('Text/Plain; charset=utf-8')).toBe('text/plain')
  })
})

describe('uploadByteLength + ENTERPRISE_MAX_UPLOAD_BYTES (M2 — upload size/shape guard)', () => {
  it('reports the byte length of real buffer shapes', () => {
    expect(uploadByteLength(new ArrayBuffer(10))).toBe(10)
    expect(uploadByteLength(new Uint8Array([1, 2, 3]))).toBe(3)
    expect(uploadByteLength(new DataView(new ArrayBuffer(4)))).toBe(4)
    expect(uploadByteLength(new Uint8Array(new ArrayBuffer(8), 2))).toBe(6) // offset view
  })

  it('returns null for a malformed (non-buffer) shape — fail closed before Buffer.from', () => {
    expect(uploadByteLength(null)).toBeNull()
    expect(uploadByteLength(undefined)).toBeNull()
    expect(uploadByteLength(1024)).toBeNull()
    expect(uploadByteLength('AAAA')).toBeNull()
    expect(uploadByteLength({ byteLength: 5 })).toBeNull() // fake shape
  })

  it('is a 50 MiB cap; a payload at the boundary passes and one byte over is rejected', () => {
    expect(ENTERPRISE_MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024)

    const atCap = uploadByteLength(new ArrayBuffer(ENTERPRISE_MAX_UPLOAD_BYTES))
    const overCap = uploadByteLength(new ArrayBuffer(ENTERPRISE_MAX_UPLOAD_BYTES + 1))

    // The handler rejects when byteLength > cap, before any network fetch.
    expect(atCap !== null && atCap > ENTERPRISE_MAX_UPLOAD_BYTES).toBe(false)
    expect(overCap !== null && overCap > ENTERPRISE_MAX_UPLOAD_BYTES).toBe(true)
  })
})

describe('classifyConnectError (M3 — connect error normalization)', () => {
  it('maps a non-loopback-http base URL to a safe insecure_base_url error', () => {
    // The exact error EnterpriseSessionStore.connect throws for http on a remote host.
    let thrown: unknown

    try {
      new EnterpriseSessionStore().connect(1, 'http://remote.example.com', 'tok')
    } catch (err) {
      thrown = err
    }

    expect(classifyConnectError(thrown)).toEqual({
      code: 'insecure_base_url',
      message: 'a non-loopback server must use https'
    })
  })

  it('maps a credentials-in-URL base to a safe invalid_base_url error', () => {
    let thrown: unknown

    try {
      new EnterpriseSessionStore().connect(1, 'https://user:pass@h.example.com', 'tok')
    } catch (err) {
      thrown = err
    }

    expect(classifyConnectError(thrown)).toEqual({
      code: 'invalid_base_url',
      message: 'the server URL must not contain credentials'
    })
  })

  it('maps a missing token, and defaults unknown errors to a generic message', () => {
    expect(classifyConnectError(new Error('missing token'))).toEqual({
      code: 'missing_token',
      message: 'a token is required'
    })
    expect(classifyConnectError(new Error('some raw internal detail'))).toEqual({
      code: 'invalid_base_url',
      message: 'enter a valid https server URL'
    })
  })

  it('never echoes the token, raw URL credentials, or a stack in the message', () => {
    let thrown: unknown

    try {
      new EnterpriseSessionStore().connect(1, 'https://user:sup3rsecret@h.example.com', 'the-bearer-token')
    } catch (err) {
      thrown = err
    }

    const out = classifyConnectError(thrown)
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('sup3rsecret')
    expect(serialized).not.toContain('the-bearer-token')
    expect(serialized).not.toContain('h.example.com')
    expect(serialized).not.toMatch(/at .*\(/) // no stack frame
  })
})

describe('B16-OL · one-login pure core (autoConnect / containment / origin)', () => {
  const BASE = 'https://enterprise.example.com'
  const SECRET = 'native-bearer-SECRET'

  // OL-Q2 · idempotency + fencing
  it('autoConnect is idempotent per sender: same id, one session, one bearer', () => {
    const store = new EnterpriseSessionStore()
    const sid1 = store.autoConnect(1, BASE, 'tok-a')
    const sid2 = store.autoConnect(1, BASE, 'tok-a')
    expect(sid2).toBe(sid1)
    expect(store.size()).toBe(1)
    expect(store.resolve(1, sid1)?.token).toBe('tok-a')
  })

  it('autoConnect keeps senders isolated', () => {
    const store = new EnterpriseSessionStore()
    const sidA = store.autoConnect(1, BASE, 'tok-a')
    const sidB = store.autoConnect(2, BASE, 'tok-b')
    expect(store.resolve(2, sidA)).toBeNull()
    expect(store.resolve(1, sidB)).toBeNull()
    expect(store.disconnect(2, sidA)).toBe(false)
    expect(store.resolve(1, sidA)?.token).toBe('tok-a')
  })

  it('currentSessionId reflects live/destroyed state', () => {
    const store = new EnterpriseSessionStore()
    expect(store.currentSessionId(1)).toBeNull()
    const sid = store.autoConnect(1, BASE, 'tok-a')
    expect(store.currentSessionId(1)).toBe(sid)
    expect(store.currentSessionId(2)).toBeNull()
    store.destroySender(1)
    expect(store.currentSessionId(1)).toBeNull()
    expect(store.resolve(1, sid)).toBeNull()
  })

  it('a superseding connect makes the old sessionId fail closed; autoConnect returns the new id', () => {
    const store = new EnterpriseSessionStore()
    const sidOld = store.autoConnect(1, BASE, 'tok-a')
    const sidNew = store.connect(1, BASE, 'tok-b')
    expect(sidNew).not.toBe(sidOld)
    expect(store.resolve(1, sidOld)).toBeNull()
    expect(store.disconnect(1, sidOld)).toBe(false)
    expect(store.autoConnect(1, BASE, 'tok-b')).toBe(sidNew)
  })

  // OL-Q1 · bearer containment
  it('buildAutoConnectResult carries only {ok,sessionId,baseUrl} — never the bearer', () => {
    const store = new EnterpriseSessionStore()
    const sid = store.autoConnect(1, BASE, SECRET)
    const result = buildAutoConnectResult(store.resolve(1, sid)!)
    expect(result).toEqual({ ok: true, sessionId: sid, baseUrl: BASE })
    expect(Object.keys(result).sort()).toEqual(['baseUrl', 'ok', 'sessionId'])
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(result)).not.toMatch(/token|bearer|accessToken/i)
  })

  // OL-Q6 · enterprise origin provenance (main-owned, trusted, distinct from gateway)
  it('normalizeEnterpriseApiOriginOrNull enforces the enterprise base-URL policy, null on absent/invalid', () => {
    expect(normalizeEnterpriseApiOriginOrNull('https://enterprise.example.com/')).toBe('https://enterprise.example.com')
    expect(normalizeEnterpriseApiOriginOrNull('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    // absent / blank -> null (one-login unavailable, never guess)
    expect(normalizeEnterpriseApiOriginOrNull('')).toBeNull()
    expect(normalizeEnterpriseApiOriginOrNull(undefined)).toBeNull()
    expect(normalizeEnterpriseApiOriginOrNull(null)).toBeNull()
    // non-loopback http, credentials-in-URL, junk -> null (never a bearer-leaking origin)
    expect(normalizeEnterpriseApiOriginOrNull('http://enterprise.example.com')).toBeNull()
    expect(normalizeEnterpriseApiOriginOrNull('https://user:pass@enterprise.example.com')).toBeNull()
    expect(normalizeEnterpriseApiOriginOrNull('not-a-url')).toBeNull()
  })
})
