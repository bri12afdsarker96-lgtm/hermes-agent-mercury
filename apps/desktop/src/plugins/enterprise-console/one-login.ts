/**
 * B16-OL · One-login session bootstrap (plugin-local).
 *
 * Installs the token-free auto transport (main holds the bearer) and probes the
 * native session. Kept to plugin-local imports (the SDK boundary: a plugin
 * depends only on `@hermes/plugin-sdk`, react, and its own modules — never on
 * the shell's `@/contrib/*`). The SHELL (`controller.tsx`) owns the projection
 * of `$sessionState` → `$enterpriseAvailable` and calls this AT BOOT, outside
 * plugin activation — which is what breaks the chicken-and-egg.
 *
 * WAVE-7 recovery (B-OL-RECOVERY-HIGH-02): the boot probe is no longer one-shot.
 * A later native login, native logout, connection re-home / soft-switch, or
 * gateway reconnect all ring the EXISTING `onConnectionApplied` push seam (which
 * main also fires on native login/logout — see main.ts), driving a bounded
 * re-probe with NO app restart, NO new perpetual timer, and NO second OAuth
 * state machine. For the one case that seam cannot observe — the enterprise
 * plane recovering while the gateway stays up and emits no event — a strictly
 * bounded, self-disarming backoff (3 attempts) re-probes while UNAVAILABLE.
 *
 * No bearer in the renderer; `defaultEnabled:false` and the user's manual
 * decision still win. A transient outage is UNAVAILABLE, not a fake
 * AUTHENTICATED (see the session FSM).
 */

import { hasIpcBridge, IpcHermesTransport } from './ipc-transport'
import { $sessionState, autoConnect, setAutoTransportFactory } from './session'

let started = false
let unsubscribeApplied: (() => void) | null = null
let unsubscribeState: (() => void) | null = null

// Strictly bounded backoff for an enterprise-only recovery the event seam can't
// see. Not perpetual: capped attempts, and disarmed the moment state leaves
// UNAVAILABLE (AUTHENTICATED / REVOKED / UNKNOWN all stop it).
const BACKOFF_MS = [2000, 4000, 8000]
let backoffTimer: null | ReturnType<typeof setTimeout> = null
let backoffAttempt = 0

function clearBackoff(): void {
  if (backoffTimer) {
    clearTimeout(backoffTimer)
    backoffTimer = null
  }

  backoffAttempt = 0
}

function armBackoff(): void {
  if (backoffTimer || backoffAttempt >= BACKOFF_MS.length) {
    return
  }

  const delay = BACKOFF_MS[backoffAttempt]

  backoffTimer = setTimeout(() => {
    backoffTimer = null
    backoffAttempt += 1
    reprobeEnterpriseSession()
  }, delay)
}

/**
 * Re-run the idempotent native-session probe. Main's EnterpriseSessionStore
 * reuses a live session per sender, so this is safe to fire repeatedly; a later
 * successful login recovers UNKNOWN/UNAVAILABLE → AUTHENTICATED without an app
 * restart. `autoConnect` never throws.
 */
export function reprobeEnterpriseSession(): void {
  if (!hasIpcBridge()) {
    return
  }

  void autoConnect()
}

export function bootstrapEnterpriseSession(): void {
  if (started) {
    return
  }

  started = true

  // Dev / browser / no desktop bridge: no native session to reuse. Leave the
  // console hidden; ConnectForm stays as the dev/migration break-glass path.
  if (!hasIpcBridge()) {
    return
  }

  setAutoTransportFactory(() => IpcHermesTransport.autoConnecting())
  void autoConnect()

  // Reuse the existing connection-applied push seam (re-home / soft-switch /
  // reconnect, and — via the main-side wiring — native login/logout) to drive a
  // bounded re-probe. No new channel, no perpetual timer.
  unsubscribeApplied = window.hermesDesktop?.onConnectionApplied?.(() => reprobeEnterpriseSession()) ?? null

  // Arm the bounded backoff only while UNAVAILABLE; disarm on any other state.
  unsubscribeState = $sessionState.subscribe(state => {
    if (state === 'UNAVAILABLE') {
      armBackoff()
    } else {
      clearBackoff()
    }
  })
}

/** Test-only: allow re-running the one-shot bootstrap. */
export function __resetOneLoginBootstrap(): void {
  started = false
  unsubscribeApplied?.()
  unsubscribeApplied = null
  unsubscribeState?.()
  unsubscribeState = null
  clearBackoff()
}
