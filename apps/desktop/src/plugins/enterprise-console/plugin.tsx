/**
 * Enterprise Console — a Phase-1 operator console for the Hermes_AI web server,
 * shipped as a bundled desktop plugin (pure SDK-consumer, zero core edits). It
 * registers one `/console` page + a sidebar entry and consumes the Hermes
 * server's core `/api/*` authority through a plugin-local REST client (the
 * server owns identity / tenant / permission / capability; the console only
 * presents them).
 *
 * It is the PRIMARY product surface: active by default (the shell pins
 * `$enterpriseAvailable` true so the plugin registers before any session
 * exists), with the unauthenticated first paint being the Design-System Login
 * bootstrap (login.tsx). The user's explicit Plugins toggle still wins.
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
import { bindSession, setAutoTransportFactory } from './session'

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

    // Root product takeover is owned by <RootRouteTakeover /> mounted at the
    // root HashRouter in main.tsx (single owner, runs before any commit). Do
    // not re-trigger it from here — duplicate owners race on the hash rewrite
    // and can leave the user on /chat with the enterprise console never
    // finishing its mount.

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        // fullWindow: the enterprise product page owns the whole window — the
        // app's session sidebar + statusbar stand down while /console is active
        // (the ConsoleShell carries its own AppSidebar / TopHeader / StatusBar),
        // so the upstream chat chrome is not the primary product frame.
        data: { fullWindow: true, path: '/console' } satisfies RouteContribution,
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
