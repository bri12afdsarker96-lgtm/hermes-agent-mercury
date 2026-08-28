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
