import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShopBrowserProfiles, type ShopBrowserAuthority } from './shop-browser-profiles'
import type { ShopBrowserRequest } from './shop-browser-types'

const temporaryRoots: string[] = []
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
const bounds = { x: 10, y: 40, width: 800, height: 600 }

async function fixture(existingRoot?: string, initialScope?: ShopBrowserAuthority) {
  const root = existingRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-shop-profiles-')))
  if (!existingRoot) temporaryRoots.push(root)
  let scope = initialScope ?? { origin: 'https://enterprise.example', tenantId: 'tenant-a', principalId: 'employee-a' }
  let current = true
  let allowed = true
  const identify = vi.fn(async () => ({ shopId: '10001', shopName: 'Shop A' }))
  const close = vi.fn(async () => {})
  const clearStorage = vi.fn(async (_storage: string) => {})
  const createView = vi.fn(async (_storage: string, _target: string, _bounds: unknown) => ({
    identify,
    close,
    clear: vi.fn(async () => {}),
    setBounds: vi.fn()
  }))
  const authorize = vi.fn(async () => {
    if (!allowed) throw new Error('REVOKED')
    return scope
  })
  const controller = new ShopBrowserProfiles({ root, createView, clearStorage, authorize, isCurrent: () => current })
  const call = (action: ShopBrowserRequest['action'], rest: Partial<ShopBrowserRequest> = {}) =>
    controller.operate({ sessionId: 'test', action, ...rest })
  const create = async () => (await call('create')).profile!
  const open = (profileId: string) => call('open', { profileId, target: 'merchant', bounds })
  return {
    root,
    controller,
    call,
    create,
    open,
    createView,
    identify,
    close,
    clearStorage,
    authorize,
    setScope: (value: ShopBrowserAuthority) => {
      scope = value
    },
    setCurrent: (value: boolean) => {
      current = value
    },
    setAllowed: (value: boolean) => {
      allowed = value
    }
  }
}

describe('persistent shop browser profiles', () => {
  it('uses compact scope-bound storage paths and keeps legacy sessions until explicit relogin', async () => {
    const f = await fixture()
    const profile = await f.create()
    await f.open(profile.id)
    const compactPath = f.createView.mock.calls[0][0]
    expect(path.relative(f.root, compactPath)).toMatch(/^sessions[/\\][a-f0-9]{64}$/)
    const files = await fs.readdir(f.root, { recursive: true })
    const metadata = path.join(f.root, String(files.find(item => String(item).endsWith('profiles.json'))))
    const data = JSON.parse(await fs.readFile(metadata, 'utf8'))
    const stored = data.profiles[0]
    expect(stored.storageLayout).toBe(2)
    delete stored.storageLayout
    await fs.writeFile(metadata, JSON.stringify(data))
    await f.call('close')
    const legacy = await fixture(f.root)
    await legacy.open(profile.id)
    const legacyPath = path.join(path.dirname(metadata), 'sessions', profile.id, stored.storageId)
    expect(legacy.createView.mock.calls[0][0]).toBe(legacyPath)
    await legacy.call('relogin', { profileId: profile.id })
    expect(legacy.clearStorage).toHaveBeenCalledWith(legacyPath)
    await legacy.open(profile.id)
    expect(path.relative(f.root, legacy.createView.mock.calls[1][0])).toMatch(/^sessions[/\\][a-f0-9]{64}$/)
    expect(JSON.stringify((await legacy.call('list')).profiles)).not.toContain('storageLayout')
  })

  it('rejects an unknown storage layout without opening a browser', async () => {
    const f = await fixture()
    const profile = await f.create()
    const files = await fs.readdir(f.root, { recursive: true })
    const metadata = path.join(f.root, String(files.find(item => String(item).endsWith('profiles.json'))))
    const data = JSON.parse(await fs.readFile(metadata, 'utf8'))
    data.profiles[0].storageLayout = 3
    await fs.writeFile(metadata, JSON.stringify(data))
    expect((await f.open(profile.id)).error).toBe('SHOP_PROFILE_STORE_INVALID')
    expect(f.createView).not.toHaveBeenCalled()
  })

  it('saves the first creation immediately and restores the same profile after restart', async () => {
    const f = await fixture()
    const profile = await f.create()
    expect(profile.loginState).toBe('unverified')
    const restarted = await fixture(f.root)
    expect((await restarted.call('list')).profiles).toEqual([profile])
    expect(JSON.stringify(profile)).not.toContain('storageId')
    expect(JSON.stringify(profile)).not.toContain(f.root)
    expect(f.createView).not.toHaveBeenCalled()
  })

  it('identifies, saves, closes and reopens the same persistent browser path', async () => {
    const f = await fixture()
    const profile = await f.create()
    expect((await f.open(profile.id)).ok).toBe(true)
    const identified = await f.call('identify', { profileId: profile.id })
    expect(identified.profile).toMatchObject({
      id: profile.id,
      shopId: '10001',
      shopName: 'Shop A',
      displayName: 'Shop A',
      loginState: 'verified'
    })
    await f.call('close')
    const restarted = await fixture(f.root)
    expect((await restarted.call('list')).profiles![0]).toEqual(identified.profile)
    await restarted.open(profile.id)
    expect(restarted.createView.mock.calls[0][0]).toBe(f.createView.mock.calls[0][0])
    expect(f.close).toHaveBeenCalledOnce()
  })

  it('isolates profiles and never borrows a different tenant or employee directory', async () => {
    const f = await fixture()
    const a = await f.create()
    const b = await f.create()
    await f.open(a.id)
    await f.open(b.id)
    expect(f.createView.mock.calls[0][0]).not.toBe(f.createView.mock.calls[1][0])
    for (const scope of [
      { origin: 'https://enterprise.example', tenantId: 'tenant-b', principalId: 'employee-a' },
      { origin: 'https://enterprise.example', tenantId: 'tenant-a', principalId: 'employee-b' },
      { origin: 'https://other.example', tenantId: 'tenant-a', principalId: 'employee-a' }
    ]) {
      const other = await fixture(f.root, scope)
      expect((await other.call('list')).profiles).toEqual([])
      expect((await other.open(a.id)).error).toBe('SHOP_PROFILE_NOT_FOUND')
      expect(other.createView).not.toHaveBeenCalled()
    }
  })

  it('relogin closes before clearing, preserves profile ID and replaces the session directory', async () => {
    const f = await fixture()
    const profile = await f.create()
    await f.open(profile.id)
    await f.call('identify', { profileId: profile.id })
    const oldPath = f.createView.mock.calls[0][0]
    const reset = await f.call('relogin', { profileId: profile.id })
    expect(reset.profile).toMatchObject({
      id: profile.id,
      shopId: null,
      shopName: null,
      loginState: 'unverified',
      checkedAt: null
    })
    expect(f.close.mock.invocationCallOrder[0]).toBeLessThan(f.clearStorage.mock.invocationCallOrder[0])
    expect(f.clearStorage).toHaveBeenCalledWith(oldPath)
    await f.open(profile.id)
    expect(f.createView.mock.calls[1][0]).not.toBe(oldPath)
    expect((await fs.stat(f.createView.mock.calls[1][0])).isDirectory()).toBe(true)
  })

  it('deletes a closed profile without opening a platform page and stays deleted after restart', async () => {
    const f = await fixture()
    const profile = await f.create()
    expect((await f.call('delete', { profileId: profile.id })).ok).toBe(true)
    expect(f.createView).not.toHaveBeenCalled()
    expect(f.clearStorage).toHaveBeenCalledOnce()
    const restarted = await fixture(f.root)
    expect((await restarted.call('list')).profiles).toEqual([])
    expect((await restarted.open(profile.id)).ok).toBe(false)
  })

  it('rechecks authority before open/read and closes on revoked access', async () => {
    const f = await fixture()
    const profile = await f.create()
    await f.open(profile.id)
    f.setAllowed(false)
    expect((await f.call('identify', { profileId: profile.id })).error).toBe('REVOKED')
    expect(f.identify).not.toHaveBeenCalled()
    expect(f.close).toHaveBeenCalledOnce()
    expect((await f.open(profile.id)).ok).toBe(false)
    expect(f.createView).toHaveBeenCalledOnce()
    f.setAllowed(true)
    expect((await f.open(profile.id)).ok).toBe(true)
    f.setAllowed(false)
    await f.controller.revalidate()
    expect(f.close).toHaveBeenCalledTimes(2)
  })

  it('rejects late identity after tenant change without saving the old result', async () => {
    const f = await fixture()
    const profile = await f.create()
    await f.open(profile.id)
    let release!: (value: { shopId: string; shopName: string }) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    f.identify.mockImplementation(() => {
      entered()
      return new Promise(resolve => {
        release = resolve
      })
    })
    const pending = f.call('identify', { profileId: profile.id })
    await started
    f.setScope({ origin: 'https://enterprise.example', tenantId: 'tenant-b', principalId: 'employee-b' })
    release({ shopId: '10001', shopName: 'Late identity' })
    expect((await pending).error).toBe('SHOP_PROFILE_OWNER_CHANGED')
    const restarted = await fixture(f.root)
    expect((await restarted.call('list')).profiles![0].shopId).toBeNull()
  })

  it('does not silently rebind a persisted profile to another shop', async () => {
    const f = await fixture()
    const profile = await f.create()
    await f.open(profile.id)
    await f.call('identify', { profileId: profile.id })
    f.identify.mockResolvedValue({ shopId: '20002', shopName: 'Another shop' })
    expect((await f.call('identify', { profileId: profile.id })).error).toBe('SHOP_PROFILE_IDENTITY_CHANGED')
    expect((await f.call('list')).profiles![0].shopId).toBe('10001')
  })

  it('serializes concurrent profile creation without losing metadata', async () => {
    const f = await fixture()
    const results = await Promise.all([f.create(), f.create(), f.create()])
    expect(new Set(results.map(item => item.id)).size).toBe(3)
    expect((await f.call('list')).profiles).toHaveLength(3)
  })

  it('fails closed for corrupt paths and malformed requests', async () => {
    const f = await fixture()
    const profile = await f.create()
    expect((await f.call('open', { profileId: '../outside', target: 'merchant', bounds })).error).toBe(
      'SHOP_PROFILE_INVALID_REQUEST'
    )
    expect((await f.call('open', { profileId: profile.id, target: 'merchant', bounds: { ...bounds, x: -1 } })).ok).toBe(
      false
    )
    expect(
      (
        await f.call('open', {
          profileId: profile.id,
          target: 'merchant',
          bounds: { ...bounds, width: '800' } as never
        })
      ).error
    ).toBe('SHOP_PROFILE_INVALID_REQUEST')
    const files = await fs.readdir(f.root, { recursive: true })
    const metadata = path.join(f.root, String(files.find(item => String(item).endsWith('profiles.json'))))
    const data = JSON.parse(await fs.readFile(metadata, 'utf8'))
    data.profiles[0].storageId = '../outside'
    await fs.writeFile(metadata, JSON.stringify(data))
    expect((await f.open(profile.id)).error).toBe('SHOP_PROFILE_STORE_INVALID')
    expect(f.createView).not.toHaveBeenCalled()
  })

  it('invalidates an in-flight open and disposes the late view after logout', async () => {
    const f = await fixture()
    const profile = await f.create()
    let release!: (view: Awaited<ReturnType<typeof f.createView>>) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    const original = f.createView.getMockImplementation()!
    f.createView.mockImplementation(() => {
      entered()
      return new Promise(resolve => {
        release = resolve
      })
    })
    const pending = f.open(profile.id)
    await started
    f.controller.invalidate()
    release(await original('unused', 'merchant', bounds))
    expect((await pending).error).toBe('SHOP_PROFILE_OWNER_CHANGED')
    expect(f.close).toHaveBeenCalledOnce()
    expect((await f.call('list')).ok).toBe(false)
  })
})
