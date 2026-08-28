/**
 * Plugin-local REST door to the Hermes_AI web server
 * (`hermes_devices/webserver.py`).
 *
 * WHY this exists instead of `ctx.rest`: the desktop's `ctx.rest` is
 * namespace-locked to `/api/plugins/<id>/*` on the desktop's OWN gateway
 * (see `src/hermes.ts`), so it cannot reach Hermes's core `/api/*` authority
 * endpoints (`/api/whoami`, `/api/biz-tasks`, `/api/delivery-outbox`, …). This
 * thin `fetch` client targets a configurable Hermes base URL and carries an
 * in-memory session bearer.
 *
 * Authority boundary (hard): the server stays the single source of truth for
 * identity / tenant / permission / capability — this client only transports.
 * It never persists the token, never logs it, and never decides permission
 * locally. Errors carry status + a coarse code only; the request URL and bearer
 * are never folded into an error message (no secret leakage into DOM/console).
 */

export type HermesErrorCode = 'error' | 'forbidden' | 'network' | 'not_implemented' | 'unauthorized'

export class HermesApiError extends Error {
  readonly code: HermesErrorCode
  readonly status: number

  constructor(status: number, code: HermesErrorCode, message: string) {
    super(message)
    this.name = 'HermesApiError'
    this.status = status
    this.code = code
  }
}

export interface HermesRequestOptions {
  body?: unknown
  method?: string
  signal?: AbortSignal
  /** In-memory session bearer; omitted for unauthenticated routes (`/api/health`). */
  token?: null | string
}

function classify(status: number): HermesErrorCode {
  if (status === 401) {
    return 'unauthorized'
  }

  if (status === 403) {
    return 'forbidden'
  }

  if (status === 501) {
    return 'not_implemented'
  }

  return 'error'
}

/** Pull a human message from a Hermes error body (`{"error": "..."}`) without
 *  trusting arbitrary shapes. */
function serverMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error: unknown }).error

    if (typeof err === 'string' && err.length > 0) {
      return err
    }
  }

  return fallback
}

/**
 * Pure request primitive: given an explicit base URL, do one JSON round-trip.
 * Kept free of module state so it is trivially testable and never reaches for a
 * global token. Callers (`session.ts`) inject the current base URL + bearer.
 */
export async function rawRequest<T>(baseUrl: string, path: string, opts: HermesRequestOptions = {}): Promise<T> {
  const base = baseUrl.trim().replace(/\/+$/, '')

  if (!base) {
    throw new HermesApiError(0, 'network', 'no server endpoint configured')
  }

  const headers: Record<string, string> = { Accept: 'application/json' }

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`
  }

  let res: Response

  try {
    res = await fetch(`${base}${path}`, {
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      headers,
      method: opts.method ?? 'GET',
      signal: opts.signal
    })
  } catch {
    // Never surface the URL/token in the message.
    throw new HermesApiError(0, 'network', 'cannot reach the Hermes server')
  }

  const text = await res.text()
  let data: unknown = null

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    throw new HermesApiError(res.status, classify(res.status), serverMessage(data, `request failed (${res.status})`))
  }

  return data as T
}
