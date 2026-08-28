import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetOneLoginBootstrap, bootstrapEnterpriseSession } from './one-login'
import { $connectError, $sessionState, $whoami } from './session'
import { $transport } from './transport'
import type { Whoami } from './types'

const WHO: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
  name: 'alice',
  principal_id: 'p1',
  product_capabilities: {},
  role: 'tenant_admin',
  tenant_id: 't1'
}

type AutoResult = { baseUrl: string; ok: true; sessionId: string } | { code: string; message: string; ok: false }

/**
 * A mutable one-login bridge: `authed` flips the native-session outcome so a
 * test can simulate "no native session at boot, then a later native login"
 * WITHOUT an app restart. `appliedCallbacks` captures onConnectionApplied
 * subscribers so the test can ring the seam.
 */
function installBridge() {
  const state = { authed: false }
  const appliedCallbacks: Array<() => void> = []

  const enterprise = {
    autoConnect: vi.fn(
      async (): Promise<AutoResult> =>
        state.authed
          ? { baseUrl: 'http://ent:8080', ok: true, sessionId: 'sid-1' }
          : { code: 'no_native_session', message: 'no authenticated native session', ok: false }
    ),
    connect: vi.fn(),
    disconnect: vi.fn(async () => ({ ok: true })),
    request: vi.fn(async () => ({ data: WHO, kind: 'ok' })),
    upload: vi.fn()
  }

  ;(window as unknown as { hermesDesktop?: unknown }).hermesDesktop = {
    enterprise,
    onConnectionApplied: (cb: () => void) => {
      appliedCallbacks.push(cb)

      return () => {
        const i = appliedCallbacks.indexOf(cb)

        if (i >= 0) {
          appliedCallbacks.splice(i, 1)
        }
      }
    }
  }

  return { appliedCallbacks, enterprise, state }
}

beforeEach(() => {
  $sessionState.set('UNKNOWN')
  $whoami.set(null)
  $connectError.set(null)
  $transport.set(null)
})

afterEach(() => {
  __resetOneLoginBootstrap()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  vi.clearAllTimers()
})

describe('bootstrapEnterpriseSession — WAVE-7 §10 recovery', () => {
  it('probes at boot; with no native session the FSM is UNKNOWN (not a fake AUTHENTICATED)', async () => {
    const bridge = installBridge()
    bootstrapEnterpriseSession()

    await vi.waitFor(() => expect(bridge.enterprise.autoConnect).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect($sessionState.get()).toBe('UNKNOWN'))
    expect($whoami.get()).toBeNull()
  })

  it('recovers to AUTHENTICATED on a later native login via the connection-applied seam (no restart)', async () => {
    const bridge = installBridge()
    bootstrapEnterpriseSession()

    await vi.waitFor(() => expect($sessionState.get()).toBe('UNKNOWN'))

    // Simulate the user completing native login later, then ring the SAME seam
    // main fires on native login — no app restart, no second bootstrap.
    bridge.state.authed = true
    expect(bridge.appliedCallbacks.length).toBe(1)
    bridge.appliedCallbacks.forEach(cb => cb())

    await vi.waitFor(() => expect($sessionState.get()).toBe('AUTHENTICATED'))
    expect(bridge.enterprise.autoConnect.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect($whoami.get()).toEqual(WHO)
  })

  it('is idempotent: a second bootstrap does not add a second subscription', () => {
    const bridge = installBridge()
    bootstrapEnterpriseSession()
    bootstrapEnterpriseSession()

    expect(bridge.appliedCallbacks.length).toBe(1)
  })
})
