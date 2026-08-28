/**
 * B16-OL · One-login shell bootstrap.
 *
 * Runs at APP/SHELL boot, OUTSIDE plugin activation — the enterprise-console
 * plugin is gated on `$enterpriseAvailable`, so the signal that decides
 * activation must be produced from here, never from inside `plugin.register()`
 * (which only runs once already activated). This is the required separation that
 * breaks the chicken-and-egg.
 *
 * It:
 *   1. installs the token-free auto transport (main holds the bearer),
 *   2. projects the session FSM onto the non-secret `$enterpriseAvailable`
 *      (`true` iff `AUTHENTICATED`), driving the EXISTING plugin manager, and
 *   3. probes once via the native session (never throws; a transient outage is
 *      UNAVAILABLE, not a fake AUTHENTICATED).
 *
 * No second plugin manager; no bearer in the renderer; `defaultEnabled:false`
 * and the user's manual decision still win (see `bindEligibility`).
 */

import { $enterpriseAvailable } from '@/contrib/enterprise-eligibility'

import { hasIpcBridge, IpcHermesTransport } from './ipc-transport'
import { autoConnect, $sessionState, setAutoTransportFactory } from './session'

let started = false

export function bootstrapEnterpriseOneLogin(): void {
  if (started) {
    return
  }
  started = true

  // Availability is a one-way projection of the session FSM. Only a real
  // `/api/whoami` (AUTHENTICATED) reveals the console; UNAVAILABLE / REVOKED /
  // UNKNOWN all keep it hidden, and a later revocation flips it back to false.
  $sessionState.subscribe(state => $enterpriseAvailable.set(state === 'AUTHENTICATED'))

  // Dev / browser / no desktop bridge: no native session to reuse. Leave the
  // console hidden; the ConnectForm break-glass path stays available for
  // dev/migration, not as the normal startup path.
  if (!hasIpcBridge()) {
    return
  }

  setAutoTransportFactory(() => IpcHermesTransport.autoConnecting())
  void autoConnect()
}

/** Test-only: allow re-running the one-shot bootstrap. */
export function __resetOneLoginBootstrap(): void {
  started = false
}
