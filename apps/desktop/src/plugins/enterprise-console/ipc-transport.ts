/**
 * IpcHermesTransport — the PRODUCTION transport. Renderer → typed preload /
 * contextBridge → IPC → Electron main → HTTPS (reusing the desktop's main
 * `fetchJson` engine). The native bearer never enters the renderer; requests
 * carry only `{ path, method, body }`, and main injects the credential.
 *
 * This works where `FetchHermesTransport` cannot: the Hermes server emits no
 * CORS and enforces a strict Origin allowlist, so a renderer `fetch` is both
 * blocked and Origin-rejected — a main-process request sends no Origin and rides
 * the bearer. Pages never change (they depend on HermesTransport).
 */

import { codeForStatus, HermesApiError } from './fetch-transport'
import { BaseHermesTransport, type TransportRequest, type UploadFile } from './transport'

type EnterpriseBridge = NonNullable<Window['hermesDesktop']['enterprise']>

function bridge(): EnterpriseBridge {
  const door = window.hermesDesktop?.enterprise

  if (!door) {
    throw new HermesApiError(0, 'network', 'desktop transport bridge unavailable')
  }

  return door
}

/** Whether the secure desktop transport bridge is available in this runtime. */
export function hasIpcBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.hermesDesktop?.enterprise)
}

export class IpcHermesTransport extends BaseHermesTransport {
  // Token-free handshake: main resolves the native bearer and `#ready` receives
  // only an opaque sessionId that fences every later call to this session.
  readonly #ready: Promise<string>

  private constructor() {
    super()

    // B16-OL · one-login: no url/token leaves the renderer; main returns only
    // the opaque sessionId (bearer stays in main).
    const handshake = bridge().autoConnect()

    this.#ready = handshake.then(result => {
      if (!result.ok) {
        // Structured, already-redacted connect error from main (bad base URL /
        // not https / missing token / no native session). Coarse message; no
        // secret. Forward ONLY the whitelisted non-secret `no_native_session`
        // reason so the FSM can map it to UNKNOWN (not UNAVAILABLE); every other
        // failure stays coarse 'error'. Never forward a bearer/sessionId/baseUrl.
        const code = result.code === 'no_native_session' ? 'no_native_session' : 'error'

        throw new HermesApiError(0, code, result.message)
      }

      return result.sessionId
    })
  }

  /** B16-OL · One-login transport: bind to a main-established enterprise session
   *  without ever handling a URL or bearer in the renderer. */
  static autoConnecting(): IpcHermesTransport {
    return new IpcHermesTransport()
  }

  async request<T>(path: string, opts: TransportRequest = {}): Promise<T> {
    const sessionId = await this.#ready
    const result = await bridge().request({ body: opts.body, method: opts.method, path, sessionId })

    if (result.kind === 'ok') {
      return result.data as T
    }

    throw new HermesApiError(result.status, codeForStatus(result.status), result.message)
  }

  async upload<T>(path: string, file: UploadFile): Promise<T> {
    const sessionId = await this.#ready

    const result = await bridge().upload({
      bytes: file.bytes,
      contentType: file.contentType,
      filename: file.filename,
      path,
      sessionId
    })

    if (result.kind === 'ok') {
      return result.data as T
    }

    throw new HermesApiError(result.status, codeForStatus(result.status), result.message)
  }

  dispose(): void {
    // Tear down exactly this session in main (fenced by sessionId) — even if the
    // connect handshake is still in flight.
    void this.#ready.then(sessionId => bridge().disconnect(sessionId)).catch(() => undefined)
  }
}
