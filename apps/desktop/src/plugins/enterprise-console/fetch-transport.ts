/**
 * FetchHermesTransport — a DEV/test `HermesTransport` that talks to a Hermes web
 * server (`hermes_devices/webserver.py`) with a direct cross-origin `fetch`,
 * carrying the bearer in renderer memory.
 *
 * ⚠️ NOT the production default. It holds the bearer in the renderer and issues
 * cross-origin authenticated requests — exactly what the production transport
 * (renderer → preload/IPC → main → HTTPS) exists to avoid. The gate replaces it
 * via `setTransportFactory` (B-T workstream); pages never change because they
 * depend on `HermesTransport`, not on this class.
 *
 * Authority boundary (hard): the server stays the single source of truth for
 * identity / tenant / permission / capability — this adapter only transports.
 * It never persists the token, never logs it; errors carry status + a coarse
 * code only (the request URL and bearer are never folded into a message).
 */

import { BaseHermesTransport, type TransportRequest } from './transport'

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

export interface RawRequestOptions extends TransportRequest {
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
 * global token.
 */
export async function rawRequest<T>(baseUrl: string, path: string, opts: RawRequestOptions = {}): Promise<T> {
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

export class FetchHermesTransport extends BaseHermesTransport {
  readonly #baseUrl: string
  // Private field: not enumerable, not serialized — the bearer never leaks via
  // the transport object into the renderer's reach.
  readonly #token: string

  constructor(baseUrl: string, token: string) {
    super()
    this.#baseUrl = baseUrl.trim().replace(/\/+$/, '')
    this.#token = token
  }

  request<T>(path: string, opts: TransportRequest = {}): Promise<T> {
    return rawRequest<T>(this.#baseUrl, path, { ...opts, token: this.#token })
  }
}
