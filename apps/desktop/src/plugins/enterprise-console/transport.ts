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

/** A file to upload as multipart/form-data (field name `file`). */
export interface UploadFile {
  bytes: ArrayBuffer
  contentType: string
  filename: string
}

export interface HermesTransport {
  /** Release any out-of-renderer state (e.g. clear the main-process bearer). */
  dispose?(): void
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  request<T>(path: string, opts?: TransportRequest): Promise<T>
  /** Multipart POST an file (knowledge-upload). Not all adapters support it. */
  upload<T>(path: string, file: UploadFile): Promise<T>
}

/** Shared get/post sugar so each implementation only writes `request`. Upload
 *  defaults to unsupported; adapters that can do multipart override it. */
export abstract class BaseHermesTransport implements HermesTransport {
  abstract request<T>(path: string, opts?: TransportRequest): Promise<T>

  get<T>(path: string): Promise<T> {
    return this.request<T>(path)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { body, method: 'POST' })
  }

  upload<T>(_path: string, _file: UploadFile): Promise<T> {
    return Promise.reject(new Error('enterprise-console: upload not supported by this transport'))
  }
}

/**
 * The default transport before a real one is installed: every call FAILS
 * CLOSED. Production installs `IpcHermesTransport` only when the desktop bridge
 * is present; tests inject a `FakeHermesTransport`. The renderer-direct fetch
 * adapter is never an automatic fallback (a packaged app without the bridge
 * must not silently downgrade to cross-origin renderer fetch).
 */
export class UnavailableHermesTransport extends BaseHermesTransport {
  request<T>(): Promise<T> {
    return Promise.reject(new Error('enterprise-console: transport unavailable'))
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
