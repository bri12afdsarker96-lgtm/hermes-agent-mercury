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

import { FetchHermesTransport, HermesApiError } from './fetch-transport'
import { $transport, type HermesTransport } from './transport'
import type { Whoami } from './types'

/** Persisted: the Hermes web-server base URL (e.g. http://127.0.0.1:8765). */
export const $baseUrl = atom<string>('')

/** In-memory ONLY — the authenticated session as the server reports it. */
export const $whoami = atom<null | Whoami>(null)

/** Coarse, redacted connect error for the UI (never contains the bearer). */
export const $connectError = atom<null | string>(null)

export const $connecting = atom<boolean>(false)

export const $connected = computed($whoami, who => who !== null)

const BASE_URL_KEY = 'hermesBaseUrl'

/**
 * How a session becomes a transport. Defaults to the DEV fetch adapter; the B-T
 * workstream installs the secure main-process/IPC transport via
 * `setTransportFactory` without touching any page or this module's flow.
 */
type TransportFactory = (baseUrl: string, token: string) => HermesTransport

let transportFactory: TransportFactory = (baseUrl, token) => new FetchHermesTransport(baseUrl, token)

export function setTransportFactory(factory: TransportFactory): void {
  transportFactory = factory
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
    $transport.set(null)
    $whoami.set(null)
    $connectError.set(null)
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
  } catch (err) {
    $transport.set(null)
    $whoami.set(null)
    $connectError.set(redactError(err))
    throw err
  } finally {
    $connecting.set(false)
  }
}

/** Re-fetch whoami on the live session (e.g. after a capability_revision bump). */
export async function refreshWhoami(): Promise<void> {
  const transport = $transport.get()

  if (!transport) {
    return
  }

  $whoami.set(await transport.request<Whoami>('/api/whoami'))
}

/** Drop the session — clears the transport (and its in-memory credential) + identity. */
export function disconnect(): void {
  $transport.set(null)
  $whoami.set(null)
  $connectError.set(null)
}
