/**
 * HermesTransport — the narrow contract every console page depends on. Callers
 * pass a path and get typed JSON back; they **never** see or pass a token. The
 * implementation owns the credential and the endpoint.
 *
 * Production form (B-T transport workstream): renderer → typed preload /
 * contextBridge → IPC → Electron main → HTTPS → Hermes. The access token lives
 * in the **main process only**; the renderer never receives the raw bearer.
 * The bundled `FetchHermesTransport` is a DEV/test adapter and must not be the
 * production default at gate-close. Because pages depend on this interface (not
 * on `fetch`), the production adapter drops in without touching any page.
 */

import { atom, useValue } from '@hermes/plugin-sdk'

export interface TransportRequest {
  body?: unknown
  method?: string
  signal?: AbortSignal
}

export interface HermesTransport {
  /** Release any out-of-renderer state (e.g. clear the main-process bearer). */
  dispose?(): void
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  request<T>(path: string, opts?: TransportRequest): Promise<T>
}

/** Shared get/post sugar so each implementation only writes `request`. */
export abstract class BaseHermesTransport implements HermesTransport {
  abstract request<T>(path: string, opts?: TransportRequest): Promise<T>

  get<T>(path: string): Promise<T> {
    return this.request<T>(path)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { body, method: 'POST' })
  }
}

/** The active transport for the connected session (null when disconnected). */
export const $transport = atom<HermesTransport | null>(null)

export function getTransport(): HermesTransport {
  const transport = $transport.get()

  if (!transport) {
    throw new Error('enterprise-console: no active transport (not connected)')
  }

  return transport
}

export function useTransport(): HermesTransport {
  const transport = useValue($transport)

  if (!transport) {
    throw new Error('enterprise-console: no active transport (not connected)')
  }

  return transport
}
