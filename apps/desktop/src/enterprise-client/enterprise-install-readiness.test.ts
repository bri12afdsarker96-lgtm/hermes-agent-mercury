import { afterEach, describe, expect, it, vi } from 'vitest'

import { $enterpriseInstallActivityRevision, $enterprisePackageInstallFrozen, prepareEnterprisePackageInstall, registerEnterpriseInstallActivity, releaseEnterprisePackageInstall } from './enterprise-install-readiness'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })

  return { promise, resolve }
}

const owners: Array<{ dispose(): void }> = []

function register(activity: Parameters<typeof registerEnterpriseInstallActivity>[0]) {
  const owner = registerEnterpriseInstallActivity(activity)
  owners.push(owner)

  return owner
}

afterEach(() => {
  releaseEnterprisePackageInstall()
  owners.splice(0).forEach(owner => owner.dispose())
  vi.useRealTimers()
})

describe('enterprise installation preservation', () => {
  it('freezes immediately, waits for durable flush and playback stop, then retains the freeze for handoff', async () => {
    const saved = deferred()
    const stopped = deferred()
    const stopPlayback = vi.fn(() => stopped.promise)
    register({ blocker: () => null, flush: () => saved.promise, stopPlayback })
    let ready = false

    const prepared = prepareEnterprisePackageInstall('install-a').then(result => { ready = result.ready;

 return result })

    expect($enterprisePackageInstallFrozen.get()).toBe(true)
    expect(ready).toBe(false)
    expect(stopPlayback).not.toHaveBeenCalled()
    saved.resolve()
    await vi.waitFor(() => expect(stopPlayback).toHaveBeenCalledOnce())
    expect(ready).toBe(false)
    stopped.resolve()
    expect(await prepared).toEqual({ ready: true, reasons: [], revision: $enterpriseInstallActivityRevision.get() })
    expect($enterprisePackageInstallFrozen.get()).toBe(true)
    releaseEnterprisePackageInstall('wrong-generation')
    expect($enterprisePackageInstallFrozen.get()).toBe(true)
    releaseEnterprisePackageInstall('install-a')
    expect($enterprisePackageInstallFrozen.get()).toBe(false)
  })

  it('does not cancel active work to make an installation appear ready', async () => {
    const stopPlayback = vi.fn()
    const flush = vi.fn()
    register({ blocker: () => '客户正在生成', stopPlayback, flush })
    expect(await prepareEnterprisePackageInstall('busy')).toMatchObject({ ready: false, reasons: ['客户正在生成'] })
    expect(stopPlayback).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
    expect($enterprisePackageInstallFrozen.get()).toBe(false)
  })

  it('rejects a stale window/account receipt if ownership changes while saving', async () => {
    const saved = deferred()
    const owner = register({ blocker: () => null, flush: () => saved.promise })
    const prepared = prepareEnterprisePackageInstall('old-window')
    owner.dispose()
    register({ blocker: () => null })
    saved.resolve()
    expect(await prepared).toMatchObject({ ready: false, reasons: [expect.stringContaining('登录状态已变化')] })
    expect($enterprisePackageInstallFrozen.get()).toBe(false)
  })

  it('releases frozen input after failed save or bounded timeout and allows a fresh attempt', async () => {
    const owner = register({ blocker: () => null, flush: async () => { throw new Error('服务器保存失败') } })
    expect(await prepareEnterprisePackageInstall('failed')).toMatchObject({ ready: false, reasons: ['服务器保存失败'] })
    owner.dispose()
    vi.useFakeTimers()
    const hanging = register({ blocker: () => null, flush: () => new Promise(() => {}) })
    const prepared = prepareEnterprisePackageInstall('timeout')
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await prepared).ready).toBe(false)
    expect($enterprisePackageInstallFrozen.get()).toBe(false)
    hanging.dispose()
    expect((await prepareEnterprisePackageInstall('retry')).ready).toBe(true)
  })

  it('rechecks new activity after flushing and exposes revision changes for main to invalidate receipts', async () => {
    const saved = deferred()
    let busy = false
    const owner = register({ blocker: () => busy ? '识别尚未结束' : null, flush: () => saved.promise })
    const revision = $enterpriseInstallActivityRevision.get()
    const prepared = prepareEnterprisePackageInstall('activity-race')
    busy = true
    owner.changed()
    saved.resolve()
    expect(await prepared).toMatchObject({ ready: false, reasons: ['识别尚未结束'] })
    expect($enterpriseInstallActivityRevision.get()).toBeGreaterThan(revision)
  })
})
