/**
 * IpcHermesTransport — the PRODUCTION transport. Renderer → typed preload /
 * contextBridge → IPC → Electron main → HTTPS (reusing the desktop's main
 * `fetchJson` engine). The bearer is shipped to the main process once at
 * construction and is never held in the renderer; requests carry only
 * `{ path, method, body }`, and main injects the credential.
 *
 * This works where `FetchHermesTransport` cannot: the Hermes server emits no
 * CORS and enforces a strict Origin allowlist, so a renderer `fetch` is both
 * blocked and Origin-rejected — a main-process request sends no Origin and rides
 * the bearer. Installed via `setTransportFactory` when the desktop bridge is
 * present (see plugin.tsx); pages never change (they depend on HermesTransport).
 */

import { codeForStatus, HermesApiError } from './fetch-transport'
import { BaseHermesTransport, type TransportRequest } from './transport'

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
  // One-way handshake: the token crosses to main here and is never stored on
  // this instance (or anywhere in the renderer).
  readonly #ready: Promise<void>

  constructor(baseUrl: string, token: string) {
    super()
    this.#ready = bridge()
      .connect(baseUrl, token)
      .then(() => undefined)
  }

  async request<T>(path: string, opts: TransportRequest = {}): Promise<T> {
    await this.#ready
    const result = await bridge().request({ body: opts.body, method: opts.method, path })

    if (result.kind === 'ok') {
      return result.data as T
    }

    throw new HermesApiError(result.status, codeForStatus(result.status), result.message)
  }

  dispose(): void {
    void bridge().disconnect()
  }
}
