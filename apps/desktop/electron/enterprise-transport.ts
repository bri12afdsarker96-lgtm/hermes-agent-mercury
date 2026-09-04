/**
 * enterprise-transport.ts
 *
 * Pure, electron-free core for the Enterprise Console (P3-M4A) main-process
 * transport: per-renderer session fencing, base-URL policy, and request-shape
 * validation. Kept standalone (no `import 'electron'`) so it unit-tests under
 * the node vitest project — main.ts wires these into the IPC layer.
 *
 * Security model (see docs/enterprise-console/INTERFACE_FREEZE.md):
 *  - The bearer for an EXTERNAL Hermes web server lives ONLY here, in the main
 *    process, per renderer (WebContents id). It is never persisted, never
 *    logged, never returned to any renderer.
 *  - Each connect mints a random opaque sessionId bound to the sender. Every
 *    request/disconnect must match BOTH the sender AND the current sessionId,
 *    so a stale transport can neither borrow a newer credential nor tear down a
 *    newer session (fail closed).
 *  - Requests are constrained to the server's `/api/*` surface with a strict
 *    method + path + origin check, so the bridge can never become an arbitrary
 *    SSRF proxy.
 */

import crypto from 'node:crypto'

import { normalizeRemoteBaseUrl } from './connection-config'

export interface EnterpriseSession {
  baseUrl: string
  sessionId: string
  token: string
}

export const ENTERPRISE_ALLOWED_METHODS = new Set(['GET', 'POST'])

/** True if the string contains any C0 control char or DEL. Written by code point
 *  (not a regex literal) to avoid embedding control characters in source. */
function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }

  return false
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  return host === 'localhost' || host === '::1' || host.startsWith('127.')
}

/**
 * Enterprise base-URL policy layered on the shared `normalizeRemoteBaseUrl`
 * (which already forces http/https, drops query/hash, and trims the path):
 *  - no embedded credentials (`http://user:pass@host`);
 *  - non-loopback hosts MUST be https (loopback may be http for a DEV seam).
 * TLS verification is never relaxed downstream.
 */
export function normalizeEnterpriseBaseUrl(raw: unknown): string {
  const base = normalizeRemoteBaseUrl(String(raw ?? ''))
  const parsed = new URL(base)

  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('base URL must not contain credentials')
  }

  if (!isLoopbackHost(parsed.hostname) && parsed.protocol !== 'https:') {
    throw new Error('non-loopback base URL must use https')
  }

  return base
}

/**
 * B16-OL · The Enterprise API origin for one-login. The Agent-plane gateway and
 * the Hermes_AI Enterprise `/api/*` plane are DISTINCT origins (proven by the
 * OL-topology council: enterprise is loopback/tunnel-bound, not co-located with
 * or reverse-proxied behind the public gateway), so main must NOT assume the
 * gateway baseUrl is the enterprise origin. This resolves a TRUSTED, main-owned,
 * non-secret origin from managed config (never a renderer value), applying the
 * same enterprise base-URL policy (https for non-loopback, no credentials).
 * Returns null (→ one-login unavailable and the console stays hidden) when the
 * config is absent or invalid — never throws, never guesses and never falls back
 * to renderer-supplied credentials.
 */
export function normalizeEnterpriseApiOriginOrNull(raw: unknown): string | null {
  const value = String(raw ?? '').trim()

  if (value === '') {
    return null
  }

  try {
    return normalizeEnterpriseBaseUrl(value)
  } catch {
    return null
  }
}

/**
 * B16-OL · The non-secret object main returns to the renderer after a one-login
 * auto-connect. It carries ONLY the opaque sessionId and the (non-secret)
 * enterprise baseUrl — the bearer stays in main and is stripped here by
 * construction (a whitelist, so a future field can never smuggle the credential).
 */
export function buildAutoConnectResult(session: EnterpriseSession): {
  ok: true
  sessionId: string
  baseUrl: string
} {
  return { ok: true, sessionId: session.sessionId, baseUrl: session.baseUrl }
}

/** Structural path guard: only the server's `/api/*` surface, no traversal in
 *  any form (dotdot, backslash, scheme-relative, or percent-encoded), no
 *  control characters. */
export function isValidEnterprisePath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//')) {
    return false
  }

  if (path.includes('..') || path.includes('\\') || hasControlChars(path)) {
    return false
  }

  const lower = path.toLowerCase()

  // Encoded traversal / encoded separators that could slip past the checks
  // above once the server decodes them.
  return !lower.includes('%2e') && !lower.includes('%2f') && !lower.includes('%5c')
}

export function isAllowedEnterpriseMethod(method: unknown): boolean {
  return typeof method === 'string' && ENTERPRISE_ALLOWED_METHODS.has(method.toUpperCase())
}

/**
 * Cap for a single main-process upload, in bytes. The Hermes server remains the
 * final authority on size; this is a cheap client-side guard so a compromised
 * renderer cannot make the main process buffer an unbounded payload before the
 * network fetch. Aligned to the Phase-1 server contract (50 MiB).
 */
export const ENTERPRISE_MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** Byte length of an upload payload, or null if the shape is not a real buffer
 *  (fail closed — a malformed shape must never reach `Buffer.from`). */
export function uploadByteLength(bytes: unknown): null | number {
  if (bytes instanceof ArrayBuffer) {
    return bytes.byteLength
  }

  if (ArrayBuffer.isView(bytes)) {
    return (bytes as ArrayBufferView).byteLength
  }

  return null
}

/** A conservative MIME essence (`type/subtype`) using RFC 6838 restricted-name
 *  characters only. Parameters (`; charset=…`) are intentionally dropped. */
const MIME_ESSENCE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

/**
 * Sanitize a renderer-supplied multipart part Content-Type. Any CR/LF/NUL/other
 * control character (via `hasControlChars`), or a value that is not a
 * well-formed `type/subtype`, is rejected and replaced by the safe default — so
 * a compromised renderer can never inject extra multipart headers or parts
 * through the Content-Type line. Returns a normalized (lower-cased, parameterless)
 * MIME essence, or `application/octet-stream`.
 */
export function sanitizeMultipartContentType(raw: unknown): string {
  const fallback = 'application/octet-stream'

  if (typeof raw !== 'string' || hasControlChars(raw)) {
    return fallback
  }

  const essence = raw.split(';', 1)[0].trim().toLowerCase()

  return MIME_ESSENCE.test(essence) ? essence : fallback
}

/**
 * Map a connect-time validation error to a safe, structured code + message.
 * Never echoes the raw input, URL credentials, server body, or a stack — only a
 * fixed operator-facing string keyed off the known validation failures.
 */
export function classifyConnectError(err: unknown): { code: string; message: string } {
  const raw = err instanceof Error ? err.message : ''

  if (raw === 'missing token') {
    return { code: 'missing_token', message: 'a token is required' }
  }

  if (raw === 'non-loopback base URL must use https') {
    return { code: 'insecure_base_url', message: 'a non-loopback server must use https' }
  }

  if (raw === 'base URL must not contain credentials') {
    return { code: 'invalid_base_url', message: 'the server URL must not contain credentials' }
  }

  return { code: 'invalid_base_url', message: 'enter a valid https server URL' }
}

/** Validate + resolve the absolute request URL, asserting it stays on the
 *  session's origin (defence in depth against host injection via the path). */
export function resolveEnterpriseUrl(baseUrl: string, path: unknown): string {
  if (!isValidEnterprisePath(path)) {
    throw new Error('invalid path')
  }

  const full = new URL(baseUrl + path)

  if (full.origin !== new URL(baseUrl).origin) {
    throw new Error('origin mismatch')
  }

  return full.toString()
}

/**
 * Per-renderer session store. Keyed by WebContents id (an opaque number passed
 * in by main), so one renderer can never see or use another's session.
 */
export class EnterpriseSessionStore {
  readonly #bySender = new Map<number, EnterpriseSession>()

  /** Mint a fenced session for `senderId`, replacing any prior one. Returns the
   *  opaque sessionId (not a secret) the renderer echoes on later calls. */
  connect(senderId: number, baseUrl: unknown, token: unknown): string {
    const normalized = normalizeEnterpriseBaseUrl(baseUrl)
    const bearer = String(token ?? '')

    if (!bearer) {
      throw new Error('missing token')
    }

    const sessionId = crypto.randomUUID()
    this.#bySender.set(senderId, { baseUrl: normalized, sessionId, token: bearer })

    return sessionId
  }

  /**
   * B16-OL · Idempotent per-sender one-login connect. If a live session already
   * exists for this sender, return its EXISTING opaque sessionId without minting
   * a second session or rotating the bearer — so the shell probe and the plugin
   * mount can both call it and converge on one session. Otherwise mint like
   * ``connect``. Keys on senderId alone (one enterprise login per renderer).
   */
  autoConnect(senderId: number, baseUrl: unknown, token: unknown): string {
    const existing = this.#bySender.get(senderId)

    if (existing) {
      return existing.sessionId
    }

    return this.connect(senderId, baseUrl, token)
  }

  /** B16-OL · The current opaque sessionId for a sender, or null (none / destroyed).
   *  Lets an idempotent auto-connect reuse a live session instead of orphaning a
   *  second one; carries no secret. */
  currentSessionId(senderId: number): string | null {
    return this.#bySender.get(senderId)?.sessionId ?? null
  }

  /** Resolve the session iff BOTH sender and sessionId match (else null). */
  resolve(senderId: number, sessionId: unknown): EnterpriseSession | null {
    const session = this.#bySender.get(senderId)

    if (!session || session.sessionId !== sessionId) {
      return null
    }

    return session
  }

  /** Remove iff sender + sessionId match — a stale sessionId cannot tear down a
   *  newer session. Returns whether anything was removed. */
  disconnect(senderId: number, sessionId: unknown): boolean {
    const session = this.#bySender.get(senderId)

    if (!session || session.sessionId !== sessionId) {
      return false
    }

    this.#bySender.delete(senderId)

    return true
  }

  /** Drop a renderer's session outright (on WebContents destruction) — no
   *  orphan bearer survives a closed window. */
  destroySender(senderId: number): void {
    this.#bySender.delete(senderId)
  }

  /** Test-only: number of live sessions. */
  size(): number {
    return this.#bySender.size
  }
}
