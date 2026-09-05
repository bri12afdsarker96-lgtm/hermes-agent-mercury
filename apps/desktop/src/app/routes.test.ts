import { describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import { contributedRoutes, NEW_CHAT_ROUTE, primaryRouteSelectedSessionId, ROUTES_AREA, sessionRoute, SETTINGS_ROUTE } from './routes'

const SESS_A = 'sess-a'
const SESS_B = 'sess-b'

describe('contributedRoutes', () => {
  it('carries the fullWindow flag from a route contribution (enterprise product chrome)', () => {
    const dispose = registry.registerMany([
      {
        area: ROUTES_AREA,
        data: { fullWindow: true, path: '/console' },
        id: 'test-fullwindow',
        render: () => null
      },
      {
        area: ROUTES_AREA,
        data: { path: '/kanban' },
        id: 'test-plain',
        render: () => null
      }
    ])

    try {
      const routes = contributedRoutes()
      expect(routes.find(route => route.path === '/console')?.fullWindow).toBe(true)
      expect(routes.find(route => route.path === '/kanban')?.fullWindow).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

describe('primaryRouteSelectedSessionId', () => {
  it('prefers the routed session id over a stale/different store selection (#59305)', () => {
    // The route already committed to B while the store selection hasn't
    // caught up yet (still reads A) — the route wins.
    expect(primaryRouteSelectedSessionId(sessionRoute(SESS_B), SESS_A)).toBe(SESS_B)
  })

  it('returns null on the new-chat route even with a leftover selection from the previous chat', () => {
    expect(primaryRouteSelectedSessionId(NEW_CHAT_ROUTE, SESS_A)).toBeNull()
  })

  it('falls back to the store selection on a non-chat route (settings, overlays)', () => {
    expect(primaryRouteSelectedSessionId(SETTINGS_ROUTE, SESS_A)).toBe(SESS_A)
  })

  it('falls back to the store selection when the route matches the same session', () => {
    expect(primaryRouteSelectedSessionId(sessionRoute(SESS_A), SESS_A)).toBe(SESS_A)
  })

  it('returns null on a non-chat route with no store selection', () => {
    expect(primaryRouteSelectedSessionId(SETTINGS_ROUTE, null)).toBeNull()
  })
})
