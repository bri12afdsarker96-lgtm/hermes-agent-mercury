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
import { bindSession, setTransportFactory } from './session'

const plugin: HermesPlugin = {
  id: 'enterprise-console',
  name: 'Enterprise Console',
  description: 'Phase-1 operator console for a Hermes server — dashboard, tasks, knowledge, handoff, and more.',
  defaultEnabled: false,
  register(ctx) {
    ctx.i18n.register(ENTERPRISE_CONSOLE_LOCALES)

    // In the desktop shell, route transport through the secure main-process
    // bridge (bearer stays in main). Dev/browser/tests without the bridge keep
    // the direct-fetch fallback. Pages are unaffected either way.
    if (hasIpcBridge()) {
      setTransportFactory((baseUrl, token) => new IpcHermesTransport(baseUrl, token))
    }

    // Persist only the (non-secret) server URL; the disposer wipes the
    // in-memory session + identity on unload/disable.
    ctx.onDispose(bindSession(ctx.storage))

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
