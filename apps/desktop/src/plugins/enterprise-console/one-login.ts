/**
 * B16-OL · One-login session bootstrap (plugin-local).
 *
 * Installs the token-free auto transport (main holds the bearer) and probes the
 * native session once. This is deliberately kept to plugin-local imports (the
 * SDK boundary: a plugin depends only on `@hermes/plugin-sdk`, react, and its own
 * modules — never on the shell's `@/contrib/*`). The SHELL (`controller.tsx`)
 * owns the projection of `$sessionState` → `$enterpriseAvailable` and calls this
 * AT BOOT, outside plugin activation — which is what breaks the chicken-and-egg:
 * the enterprise-console plugin is gated on `$enterpriseAvailable`, so the signal
 * that decides activation is produced from the shell, never from inside
 * `plugin.register()`.
 *
 * No bearer in the renderer; `defaultEnabled:false` and the user's manual
 * decision still win (see `bindEligibility`). A transient outage is UNAVAILABLE,
 * not a fake AUTHENTICATED (see the session FSM).
 */

import { hasIpcBridge, IpcHermesTransport } from './ipc-transport'
import { autoConnect, setAutoTransportFactory } from './session'

let started = false

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
}

/** Test-only: allow re-running the one-shot bootstrap. */
export function __resetOneLoginBootstrap(): void {
  started = false
}
