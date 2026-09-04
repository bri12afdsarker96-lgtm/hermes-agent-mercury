import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  $pluginDecisions,
  $pluginRecords,
  bindEligibility,
  dropPlugin,
  publishPlugin
} from './plugins-store'

const ID = 'enterprise-console'

/** A fake loader handle whose activate mimics the real one (publishes a
 *  `loaded` record), so the reconcile idempotency guard behaves as in prod. */
function fakeHandle() {
  const activate = vi.fn(() => {
    publishPlugin({ id: ID, kind: 'bundled', name: ID, status: 'loaded' })
  })

  const deactivate = vi.fn()

  return { activate, deactivate }
}

function seedDisabled(handle: { activate: () => void; deactivate: () => void }) {
  publishPlugin({ id: ID, kind: 'bundled', name: ID, status: 'disabled' }, handle)
}

afterEach(() => {
  dropPlugin(ID)
  $pluginDecisions.set({})
  $pluginRecords.set({})
})

describe('bindEligibility — capability-driven plugin activation', () => {
  it('activates when available (no user decision) and hides when unavailable', () => {
    const handle = fakeHandle()
    seedDisabled(handle)
    const available = atom(false)

    const dispose = bindEligibility(ID, available)
    expect(handle.activate).not.toHaveBeenCalled() // false at boot → hidden

    available.set(true)
    expect(handle.activate).toHaveBeenCalledTimes(1)
    expect($pluginRecords.get()[ID].status).toBe('loaded')

    available.set(false)
    expect(handle.deactivate).toHaveBeenCalledTimes(1)
    expect($pluginRecords.get()[ID].status).toBe('disabled')

    dispose()
  })

  it('lets an explicit user DISABLE win over availability', () => {
    const handle = fakeHandle()
    seedDisabled(handle)
    const available = atom(true)
    $pluginDecisions.set({ [ID]: false })

    const dispose = bindEligibility(ID, available)
    expect(handle.activate).not.toHaveBeenCalled() // decision=false beats available=true

    dispose()
  })

  it('lets an explicit user ENABLE pin it on despite availability=false (break-glass)', () => {
    const handle = fakeHandle()
    seedDisabled(handle)
    const available = atom(false)
    $pluginDecisions.set({ [ID]: true })

    const dispose = bindEligibility(ID, available)
    expect(handle.activate).toHaveBeenCalledTimes(1)

    dispose()
  })

  it('removes the entry on revocation (available true → false deactivates)', () => {
    const handle = fakeHandle()
    seedDisabled(handle)
    const available = atom(true)

    const dispose = bindEligibility(ID, available)
    expect(handle.activate).toHaveBeenCalledTimes(1) // session present → shown

    available.set(false) // session revoked
    expect(handle.deactivate).toHaveBeenCalledTimes(1)
    expect($pluginRecords.get()[ID].status).toBe('disabled')

    dispose()
  })

  it('never writes a plugin decision (auto-enable is not a manual choice)', () => {
    const handle = fakeHandle()
    seedDisabled(handle)
    const available = atom(true)

    const dispose = bindEligibility(ID, available)
    // Auto-enable must not persist a decision, or a later revoke could not turn
    // it back off.
    expect(ID in $pluginDecisions.get()).toBe(false)

    dispose()
  })

  it('reacts to a later user decision flip through the same handles', () => {
    const handle = fakeHandle()
    seedDisabled(handle)
    const available = atom(true)

    const dispose = bindEligibility(ID, available)
    expect(handle.activate).toHaveBeenCalledTimes(1)

    $pluginDecisions.set({ [ID]: false }) // user disables while available
    expect(handle.deactivate).toHaveBeenCalledTimes(1)
    expect($pluginRecords.get()[ID].status).toBe('disabled')

    dispose()
  })

  it('disposer detaches listeners (no further reconcile)', () => {
    const handle = fakeHandle()
    seedDisabled(handle)
    const available = atom(false)

    const dispose = bindEligibility(ID, available)
    dispose()

    available.set(true)
    expect(handle.activate).not.toHaveBeenCalled()
  })
})
