/**
 * Enterprise Console session state.
 *
 * The console defers ENTIRELY to the Hermes server for identity: it connects,
 * calls `GET /api/whoami` through the active `HermesTransport`, and mirrors the
 * returned principal / tenant / role / permissions / capabilities. It defines no
 * second identity authority and makes no local permission decision.
 *
 * Secret hygiene (hard rule): the base URL is persisted (it is not a secret),
 * but the bearer is never exposed here — it lives inside the transport instance
 * (in the main process for the production adapter). No public atom carries the
 * token; nothing is persisted or logged. `bindSession`'s disposer clears the
 * transport + identity on unload/disable.
 */

import { atom, computed, type PluginStorage } from '@hermes/plugin-sdk'

import { HermesApiError } from './fetch-transport'
import { $transport, type HermesTransport, UnavailableHermesTransport } from './transport'
import type { Whoami } from './types'

/** Persisted: the Hermes web-server base URL (e.g. http://127.0.0.1:8765). */
export const $baseUrl = atom<string>('')

/** In-memory ONLY — the authenticated session as the server reports it. */
export const $whoami = atom<null | Whoami>(null)

/** Coarse, redacted connect error for the UI (never contains the bearer). */
export const $connectError = atom<null | string>(null)

export const $connecting = atom<boolean>(false)

export const $connected = computed($whoami, who => who !== null)

/**
 * B16-OL · one-login session FSM. The shell projects `$enterpriseAvailable` from
 * `AUTHENTICATED`, so the states must never lie:
 *   UNKNOWN       — not yet probed, or no authenticated native session to use;
 *   AUTHENTICATED — a real `/api/whoami` resolved;
 *   UNAVAILABLE   — gateway/Hermes outage (retryable) — NOT a revocation;
 *   REVOKED       — the federated authority rejected the session (401/403).
 * A failed probe never transitions to AUTHENTICATED.
 */
export type EnterpriseSessionState = 'UNKNOWN' | 'AUTHENTICATED' | 'UNAVAILABLE' | 'REVOKED'
export const $sessionState = atom<EnterpriseSessionState>('UNKNOWN')

const BASE_URL_KEY = 'hermesBaseUrl'

/** A federated-authority rejection (revocation) vs a transient outage. */
function isRevocation(err: unknown): boolean {
  return err instanceof HermesApiError && (err.code === 'unauthorized' || err.code === 'forbidden')
}

/**
 * Map a probe failure to the honest FSM state (frozen contract):
 *   no authenticated native session (coarse non-secret reason) → UNKNOWN;
 *   401/403 from a real whoami                                 → REVOKED;
 *   network / 5xx / authority outage / no enterprise origin     → UNAVAILABLE.
 * A missing native session is NOT an outage — the console is simply not yet
 * eligible (the user has not completed native login), so it must read UNKNOWN,
 * never UNAVAILABLE.
 */
function stateForError(err: unknown): EnterpriseSessionState {
  if (err instanceof HermesApiError && err.code === 'no_native_session') {
    return 'UNKNOWN'
  }

  return isRevocation(err) ? 'REVOKED' : 'UNAVAILABLE'
}

/**
 * How a session becomes a transport. Defaults to the DEV fetch adapter; the B-T
 * workstream installs the secure main-process/IPC transport via
 * `setTransportFactory` without touching any page or this module's flow.
 */
type TransportFactory = (baseUrl: string, token: string) => HermesTransport

// Fail closed by default: until the desktop bridge installs the secure IPC
// transport (or a test injects a fake), connect cannot reach a server.
let transportFactory: TransportFactory = () => new UnavailableHermesTransport()

export function setTransportFactory(factory: TransportFactory): void {
  transportFactory = factory
}

// B16-OL · one-login transport: no baseUrl/token — main holds both. Fail closed
// until the desktop bridge installs the auto factory.
type AutoTransportFactory = () => HermesTransport
let autoTransportFactory: AutoTransportFactory = () => new UnavailableHermesTransport()

export function setAutoTransportFactory(factory: AutoTransportFactory): void {
  autoTransportFactory = factory
}

/**
 * Hydrate the base URL from storage and keep it in sync. Returns a disposer that
 * also drops the transport (and its credential) + identity — so disabling the
 * plugin leaves no session behind.
 */
export function bindSession(storage: PluginStorage): () => void {
  $baseUrl.set(storage.get<string>(BASE_URL_KEY, ''))
  const unsub = $baseUrl.listen(value => storage.set(BASE_URL_KEY, value))

  return () => {
    unsub()
    $transport.get()?.dispose?.()
    $transport.set(null)
    $whoami.set(null)
    $connectError.set(null)
    $sessionState.set('UNKNOWN')
  }
}

function redactError(err: unknown): string {
  if (err instanceof HermesApiError) {
    if (err.code === 'unauthorized') {
      return 'authentication failed — check the token'
    }

    if (err.code === 'network') {
      return 'cannot reach the Hermes server — check the address'
    }

    return err.message
  }

  return 'connection failed'
}

/**
 * Connect with a principal bearer: build the transport (which owns the
 * credential), then let the SERVER establish the session by returning whoami.
 * On any failure the transport is dropped and identity stays null (fail closed).
 */
export async function connect(baseUrl: string, token: string): Promise<void> {
  $connecting.set(true)
  $connectError.set(null)
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  $baseUrl.set(trimmed)
  const transport = transportFactory(trimmed, token)

  try {
    const who = await transport.request<Whoami>('/api/whoami')
    $transport.set(transport)
    $whoami.set(who)
    $sessionState.set('AUTHENTICATED')
  } catch (err) {
    transport.dispose?.()
    $transport.set(null)
    $whoami.set(null)
    $connectError.set(redactError(err))
    $sessionState.set(stateForError(err))
    throw err
  } finally {
    $connecting.set(false)
  }
}

/**
 * B16-OL · One-login. Establish the session using the native bearer main already
 * holds — the renderer passes no URL and no token. Used as the boot/mount probe:
 * it NEVER throws, so a transient outage (UNAVAILABLE) is not confused with a hard
 * revocation (REVOKED) and the shell can decide availability from `$sessionState`.
 * Returns true iff it reached AUTHENTICATED.
 */
export async function autoConnect(): Promise<boolean> {
  $connecting.set(true)
  $connectError.set(null)
  const transport = autoTransportFactory()

  try {
    const who = await transport.request<Whoami>('/api/whoami')
    $transport.set(transport)
    $whoami.set(who)
    $sessionState.set('AUTHENTICATED')

    return true
  } catch (err) {
    transport.dispose?.()
    $transport.set(null)
    $whoami.set(null)
    $connectError.set(redactError(err))
    $sessionState.set(stateForError(err))

    return false
  } finally {
    $connecting.set(false)
  }
}

/** Re-fetch whoami on the live session (e.g. after a capability_revision bump).
 *  A 401/403 here is a revocation: drop identity and mark REVOKED (the shell then
 *  deactivates the console). A transient outage leaves the session intact. */
export async function refreshWhoami(): Promise<void> {
  const transport = $transport.get()

  if (!transport) {
    return
  }

  try {
    $whoami.set(await transport.request<Whoami>('/api/whoami'))
    $sessionState.set('AUTHENTICATED')
  } catch (err) {
    if (isRevocation(err)) {
      transport.dispose?.()
      $transport.set(null)
      $whoami.set(null)
      $connectError.set(redactError(err))
      $sessionState.set('REVOKED')
    } else {
      // Transient outage: KEEP the live transport (recovery reuses it), but the
      // state must go UNAVAILABLE so $enterpriseAvailable flips false — the
      // console must not keep asserting AUTHENTICATED through an outage.
      $sessionState.set('UNAVAILABLE')
    }
  }
}

/** Drop the session — clears the transport (and its in-memory credential) + identity. */
export function disconnect(): void {
  $transport.get()?.dispose?.()
  $transport.set(null)
  $whoami.set(null)
  $connectError.set(null)
  $sessionState.set('UNKNOWN')
}
