/**
 * Enterprise Console session state.
 *
 * The console defers ENTIRELY to the Hermes server for identity: it holds a
 * bearer only in memory, calls `GET /api/whoami`, and mirrors the returned
 * principal / tenant / role / permissions / capabilities. It defines no second
 * identity authority and makes no local permission decision.
 *
 * Secret hygiene (hard rule): the base URL is persisted (it is not a secret),
 * but the bearer and whoami live in memory ONLY — never `storage`/localStorage,
 * never logged. `bindSession`'s disposer wipes them on unload/disable.
 */

import { atom, type PluginStorage } from '@hermes/plugin-sdk'

import { HermesApiError, type HermesRequestOptions, rawRequest } from './hermes-client'
import type { Whoami } from './types'

/** Persisted: the Hermes web-server base URL (e.g. http://127.0.0.1:8765). */
export const $baseUrl = atom<string>('')

/** In-memory ONLY — the session bearer. Never persisted, never logged. */
export const $token = atom<null | string>(null)

/** In-memory ONLY — the authenticated session as the server reports it. */
export const $whoami = atom<null | Whoami>(null)

/** Coarse, redacted connect error for the UI (never contains the bearer). */
export const $connectError = atom<null | string>(null)

export const $connecting = atom<boolean>(false)

const BASE_URL_KEY = 'hermesBaseUrl'

/**
 * Hydrate the base URL from storage and keep it in sync. Returns a disposer
 * that also wipes the in-memory secret + identity — so disabling the plugin
 * leaves no session behind.
 */
export function bindSession(storage: PluginStorage): () => void {
  $baseUrl.set(storage.get<string>(BASE_URL_KEY, ''))
  const unsub = $baseUrl.listen(value => storage.set(BASE_URL_KEY, value))

  return () => {
    unsub()
    $token.set(null)
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

/** Authenticated request against the current session (base URL + in-memory bearer). */
export function apiRequest<T>(path: string, opts: Omit<HermesRequestOptions, 'token'> = {}): Promise<T> {
  return rawRequest<T>($baseUrl.get(), path, { ...opts, token: $token.get() })
}

/** Unauthenticated request (e.g. `/api/health`) against the current base URL. */
export function publicRequest<T>(path: string, opts: Omit<HermesRequestOptions, 'token'> = {}): Promise<T> {
  return rawRequest<T>($baseUrl.get(), path, opts)
}

/**
 * Connect with a principal bearer: point at the server, then let the SERVER
 * establish the session by returning whoami. On any failure the bearer is
 * dropped and identity stays null (fail closed).
 */
export async function connect(baseUrl: string, token: string): Promise<void> {
  $connecting.set(true)
  $connectError.set(null)
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  $baseUrl.set(trimmed)

  try {
    const who = await rawRequest<Whoami>(trimmed, '/api/whoami', { token })
    $token.set(token)
    $whoami.set(who)
  } catch (err) {
    $token.set(null)
    $whoami.set(null)
    $connectError.set(redactError(err))
    throw err
  } finally {
    $connecting.set(false)
  }
}

/** Re-fetch whoami on the live session (e.g. after a capability_revision bump). */
export async function refreshWhoami(): Promise<void> {
  if (!$token.get()) {
    return
  }

  const who = await apiRequest<Whoami>('/api/whoami')
  $whoami.set(who)
}

/** Drop the session — wipes the in-memory bearer and identity. */
export function disconnect(): void {
  $token.set(null)
  $whoami.set(null)
  $connectError.set(null)
}
