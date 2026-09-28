import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEnterpriseUpdateReadiness } from './enterprise-update-readiness'

describe('enterprise update readiness lease', () => {
  afterEach(() => vi.useRealTimers())

  function setup() {
    let destroyed = false
    let blockers: string[] = []
    const target = { id: 7, isDestroyed: () => destroyed, send: vi.fn() }
    const coordinator = createEnterpriseUpdateReadiness({ getWindow: () => target, blockers: () => blockers, timeoutMs: 100 })

    return { target, coordinator, destroy: () => { destroyed = true }, block: () => { blockers = ['另一个窗口仍有工作'] } }
  }

  it('requires the current window and transaction to acknowledge a fresh revision', async () => {
    const { coordinator } = setup()
    let settled = false

    const promise = coordinator.prepare('attempt-a').then(value => { settled = true;

 return value })

    coordinator.reply(8, { transactionId: 'attempt-a', ready: true, reasons: [], revision: 3 })
    coordinator.reply(7, { transactionId: 'attempt-old', ready: true, reasons: [], revision: 3 })
    await Promise.resolve()
    expect(settled).toBe(false)
    coordinator.changed(7, { revision: 3 })
    coordinator.reply(7, { transactionId: 'attempt-a', ready: true, reasons: [], revision: 3 })
    const lease = await promise
    expect(lease.isStillReady()).toBe(true)
    coordinator.changed(7, { revision: 4 })
    expect(lease.isStillReady()).toBe(false)
    lease.release()
  })

  it('rejects a stale acknowledgement and unfreezes instead of overwriting newer work', async () => {
    const { coordinator, target } = setup()
    const promise = coordinator.prepare('attempt-a')
    coordinator.changed(7, { revision: 4 })
    coordinator.reply(7, { transactionId: 'attempt-a', ready: true, reasons: [], revision: 3 })
    expect((await promise).ready).toBe(false)
    expect(target.send).toHaveBeenLastCalledWith('hermes:enterprise:package-update-release', { transactionId: 'attempt-a' })
  })

  it.each(['destroy', 'block', 'navigate'] as const)('revokes readiness when the window changes: %s', async change => {
    const setupResult = setup()
    const promise = setupResult.coordinator.prepare('attempt-a')
    setupResult.coordinator.reply(7, { transactionId: 'attempt-a', ready: true, reasons: [], revision: 0 })
    const lease = await promise

    if (change === 'navigate') {setupResult.coordinator.invalidate(7)}
    else {setupResult[change]()}

    expect(lease.isStillReady()).toBe(false)
    lease.release()
  })

  it('bounds an unresponsive renderer and permits a later explicit retry', async () => {
    vi.useFakeTimers()
    const { coordinator } = setup()
    const pending = coordinator.prepare('attempt-a')
    await vi.advanceTimersByTimeAsync(100)
    expect((await pending).ready).toBe(false)
    const retry = coordinator.prepare('attempt-b')
    coordinator.reply(7, { transactionId: 'attempt-b', ready: true, reasons: [], revision: 0 })
    const lease = await retry
    expect(lease.isStillReady()).toBe(true)
    lease.release()
  })
})
