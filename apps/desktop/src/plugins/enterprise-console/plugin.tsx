/**
 * Enterprise Console — a Phase-1 operator console for the Hermes_AI web server,
 * shipped as a bundled desktop plugin (pure SDK-consumer, zero core edits). It
 * registers one `/console` page + a sidebar entry and consumes the Hermes
 * server's core `/api/*` authority through a plugin-local REST client (the
 * server owns identity / tenant / permission / capability; the console only
 * presents them).
 *
 * Ships OFF by default (`defaultEnabled: false`): it inventories in
 * Settings ▸ Plugins and registers nothing until the operator flips the switch.
 */

import {
  type HermesPlugin,
  host,
  PALETTE_AREA,
  type PaletteContribution,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution
} from '@hermes/plugin-sdk'

import { ConsoleShell } from './console'
import { ENTERPRISE_CONSOLE_LOCALES } from './i18n'
import { hasIpcBridge, IpcHermesTransport } from './ipc-transport'
import { bindSession, $sessionState, setAutoTransportFactory } from './session'

const plugin: HermesPlugin = {
  id: 'enterprise-console',
  name: 'Enterprise Console',
  description: 'Phase-1 operator console for a Hermes server — dashboard, tasks, knowledge, handoff, and more.',
  defaultEnabled: true,
  register(ctx) {
    ctx.i18n.register(ENTERPRISE_CONSOLE_LOCALES)

    // In the desktop shell, route transport through the secure main-process
    // bridge (bearer stays in main). Without the bridge the default transport
    // fails closed — no silent renderer-direct-fetch fallback. Pages are
    // unaffected either way (they depend on the HermesTransport interface).
    if (hasIpcBridge()) {
      // B16-OL · one-login: the token-free transport whose session main
      // establishes from the native bearer. Installing the factory is not a
      // probe — the console mount / shell bootstrap drives autoConnect.
      setAutoTransportFactory(() => IpcHermesTransport.autoConnecting())
    }

    // Persist only the (non-secret) server URL; the disposer wipes the
    // in-memory session + identity on unload/disable.
    ctx.onDispose(bindSession(ctx.storage))

    // Root product takeover: once the native-bridged session is AUTHENTICATED,
    // navigate to the enterprise console on the first transition. This makes
    // Hermes-企业助手 the primary default product experience (the upstream
    // chat surface remains reachable but is no longer the default landing).
    let didTakeOver = false
    const unsubscribeSession = $sessionState.subscribe(state => {
      if (state === 'AUTHENTICATED' && !didTakeOver) {
        didTakeOver = true
        if (typeof window !== 'undefined' && (window.location.hash === '' || window.location.hash === '#/' || window.location.hash === '#/new')) {
          host.navigate('/console')
        }
      }
    })
    ctx.onDispose(unsubscribeSession)

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/console' } satisfies RouteContribution,
        render: () => <ConsoleShell />
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 60,
        data: { codicon: 'organization', label: ctx.i18n.t('nav'), path: '/console' } satisfies SidebarNavContribution
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'enterprise-console.open',
          keywords: ['enterprise', 'console', 'admin', 'hermes', 'dashboard'],
          label: 'Enterprise Console: Open',
          run: () => host.navigate('/console')
        } satisfies PaletteContribution
      }
    ])
  }
}

export default plugin
