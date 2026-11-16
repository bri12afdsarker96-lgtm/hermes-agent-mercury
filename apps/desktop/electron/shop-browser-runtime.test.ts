import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CloudShopRecord, ShopProfileCloud } from './shop-browser-cloud'
import type { ShopBrowserAuthority } from './shop-browser-profiles'
import { ShopBrowserRuntime } from './shop-browser-runtime'
import { ShopBrowserTabs } from './shop-browser-tabs'
import type { ShopBrowserRequest } from './shop-browser-types'

const roots: string[] = []
const runtimes: ShopBrowserRuntime[] = []
const bounds = { x: 10, y: 40, width: 800, height: 600 }
const initialAuthority = { origin: 'https://enterprise.example', tenantId: 'tenant-a', principalId: 'employee-a' }

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.invalidate()
    await runtime.revalidate()
  }

  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture(options: { root?: string; authority?: ShopBrowserAuthority; cloud?: ShopProfileCloud } = {}) {
  const root = options.root ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-shop-runtime-')))

  if (!options.root) {
    roots.push(root)
  }

  let authority = options.authority ?? initialAuthority
  let allowed = true
  let current = true
  let failCreation = false
  let identity = { shopId: '10001', shopName: 'Synthetic shop A' }
  const identities = new Map<string, typeof identity>()
  const events: string[] = []

  const views: {
    storage: string
    tabs: ShopBrowserTabs
    pages: { visible: boolean; closed: boolean }[]
    closed: boolean
    close: ReturnType<typeof vi.fn>
  }[] = []

  const executions: { close: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn> }[] = []
  let maximumLiveViews = 0

  const clearStorage = vi.fn(async (storage: string) => {
    expect(views.filter(view => view.storage === storage).every(view => view.closed)).toBe(true)
    events.push(`clear:${storage}`)
  })

  const createView = vi.fn(async (storage: string, _target: string, initialBounds: typeof bounds) => {
    if (failCreation) {
      throw new Error('SYNTHETIC_CREATE_FAILED')
    }

    identities.set(storage, identities.get(storage) ?? { ...identity })
    await fs.mkdir(storage, { recursive: true })
    const marker = path.join(storage, 'synthetic-login-marker')
    await fs.writeFile(marker, 'preserved-login', { flag: 'a' })
    const pages: { visible: boolean; closed: boolean }[] = []

    const tabs = await new ShopBrowserTabs(
      {
        isCurrent: () => current,
        async createPage(url) {
          let address = url
          const page = { visible: false, closed: false }
          pages.push(page)

          return {
            identify: async () => identities.get(storage)!,
            setBounds() {},
            close: async () => {
              page.closed = true
              page.visible = false
            },
            browser: {
              state: () => ({
                url: address,
                title: 'Synthetic page',
                loading: false,
                canGoBack: false,
                canGoForward: false
              }),
              navigate: next => {
                address = next
              },
              back() {},
              forward() {},
              reload() {},
              setVisible: visible => {
                page.visible = visible
              }
            }
          }
        }
      },
      initialBounds,
      'https://fxg.jinritemai.com/home'
    ).initialize('https://fxg.jinritemai.com/orders')

    const entry = {
      storage,
      tabs,
      pages,
      closed: false,
      close: vi.fn(async () => {
        await tabs.close()
        entry.closed = true
        events.push(`close:${storage}`)
      })
    }

    views.push(entry)
    maximumLiveViews = Math.max(maximumLiveViews, views.filter(view => !view.closed).length)
    events.push(`create:${storage}`)

    return {
      workspace: tabs,
      identify: () => tabs.identify(),
      setBounds: next => tabs.setBounds(next),
      close: entry.close
    }
  })

  const createExecution = vi.fn(async (storage: string) => {
    const execution = {
      identify: async () => identities.get(storage) ?? identity,
      command: vi.fn(async (_targetId: string, method: string) => ({ method })),
      close: vi.fn(async () => {})
    }

    executions.push(execution)

    return execution
  })

  const runtime = new ShopBrowserRuntime({
    root,
    createView,
    clearStorage,
    createExecution,
    authorize: async () => {
      if (!allowed) {
        throw new Error('SHOP_PROFILE_FORBIDDEN')
      }

      return authority
    },
    isCurrent: () => current,
    cloud: options.cloud,
    exportSession: async () => ({ version: 1, cookies: [], origins: [] }),
    importSession: async () => {}
  })

  runtimes.push(runtime)

  const call = (action: ShopBrowserRequest['action'], rest: Partial<ShopBrowserRequest> = {}) =>
    runtime.operate({ sessionId: 'test', action, ...rest })

  const create = async () => (await call('create')).profile!
  const open = (profileId: string) => call('open', { profileId, target: 'merchant', bounds })
  const snapshot = async () => (await runtime.configure({ sessionId: 'test', action: 'snapshot' })).snapshot!

  const setLimit = (maxConcurrentBrowsers: number) =>
    runtime.configure({ sessionId: 'test', action: 'setLimit', maxConcurrentBrowsers })

  const register = async (shopId: string) => {
    identity = { shopId, shopName: `Synthetic shop ${shopId}` }
    const profile = await create()
    expect((await open(profile.id)).ok).toBe(true)

    return (await call('identify', { profileId: profile.id })).profile!
  }

  return {
    root,
    runtime,
    call,
    create,
    open,
    snapshot,
    setLimit,
    register,
    createView,
    clearStorage,
    views,
    executions,
    events,
    maxLive: () => maximumLiveViews,
    revoke: () => {
      allowed = false
    },
    changeOwner: () => {
      authority = { ...authority, principalId: 'employee-b' }
    },
    failCreation: () => {
      failCreation = true
    },
    expire: () => {
      current = false
    }
  }
}

describe('local shop browser runtime', () => {
  it.each(['null', '[]', '{"version":1,"maxConcurrentBrowsers":11}'])(
    'preserves an invalid runtime settings document %s',
    async document => {
      const f = await fixture()
      await f.setLimit(2)
      const directory = path.join(f.root, 'runtime')
      const file = path.join(directory, (await fs.readdir(directory))[0])
      await fs.writeFile(file, document)
      const restarted = await fixture({ root: f.root })
      const reply = await restarted.runtime.configure({ sessionId: 'test', action: 'setLimit', maxConcurrentBrowsers: 4 })

      expect(reply.error).toBe('SHOP_BROWSER_RUNTIME_STORE_INVALID')
      expect(await fs.readFile(file, 'utf8')).toBe(document)
    }
  )
  it('persists the native 1–10 browser limit by authority and restores it after restart', async () => {
    const f = await fixture()
    expect(await f.snapshot()).toMatchObject({
      maxConcurrentBrowsers: 3,
      browsers: [],
      receptionControl: { available: false }
    })

    for (const value of [0, 11, 2.5, Number.NaN]) {
      expect((await f.setLimit(value)).error).toBe('SHOP_BROWSER_RUNTIME_INVALID_REQUEST')
    }

    expect((await f.setLimit(2)).ok).toBe(true)
    const restored = await fixture({ root: f.root })
    expect((await restored.snapshot()).maxConcurrentBrowsers).toBe(2)
    const otherEmployee = await fixture({ root: f.root, authority: { ...initialAuthority, principalId: 'employee-b' } })
    expect((await otherEmployee.snapshot()).maxConcurrentBrowsers).toBe(3)
    expect((await fs.readdir(path.join(f.root, 'runtime'))).every(file => file.endsWith('.json'))).toBe(true)
  })

  it('retains live tabs while switching A/B/A and makes only the active page visible', async () => {
    const f = await fixture()
    const a = await f.create()
    const b = await f.create()
    await f.open(a.id)
    await f.call('browser', { profileId: a.id, browser: { action: 'new', url: 'https://fxg.jinritemai.com/second' } })
    const aTabs = f.views[0].tabs.snapshot()
    await f.open(b.id)
    expect(f.views[0].pages.every(page => !page.visible && !page.closed)).toBe(true)
    await f.open(a.id)
    expect(f.createView).toHaveBeenCalledTimes(2)
    expect(f.views[0].tabs.snapshot().tabs).toEqual(aTabs.tabs)
    expect(f.views[0].pages.filter(page => page.visible)).toHaveLength(1)
    expect(f.views[1].pages.every(page => !page.visible)).toBe(true)
    expect((await f.snapshot()).browsers.filter(browser => browser.active).map(browser => browser.profileId)).toEqual([
      a.id
    ])
  })

  it('reclaims the least recently used view before creating another and preserves login files', async () => {
    const f = await fixture()
    const [a, b, c] = await Promise.all([f.create(), f.create(), f.create()])
    await f.setLimit(2)
    await f.open(a.id)
    await f.open(b.id)
    const loginBefore = await fs.readFile(path.join(f.views[1].storage, 'synthetic-login-marker'))
    await f.open(a.id)
    await f.open(c.id)
    expect(f.views.map(view => view.closed)).toEqual([false, true, false])
    expect(f.maxLive()).toBe(2)
    expect(f.events.indexOf(`close:${f.views[1].storage}`)).toBeLessThan(
      f.events.indexOf(`create:${f.views[2].storage}`)
    )
    expect(await fs.readFile(path.join(f.views[1].storage, 'synthetic-login-marker'))).toEqual(loginBefore)
    expect(f.clearStorage).not.toHaveBeenCalled()
    expect((await f.call('list')).profiles?.map(profile => profile.id)).toEqual([a.id, b.id, c.id])
  })

  it('serializes concurrent opens and keeps the most recent shop when lowering the limit', async () => {
    const f = await fixture()
    const profiles = await Promise.all([f.create(), f.create(), f.create(), f.create()])
    await f.setLimit(2)
    expect((await Promise.all(profiles.map(profile => f.open(profile.id)))).every(reply => reply.ok)).toBe(true)
    expect(f.maxLive()).toBe(2)
    const reduced = await f.setLimit(1)
    expect(reduced.snapshot?.browsers.map(browser => browser.profileId)).toEqual([profiles[3].id])
    expect((await f.call('list')).openProfileId).toBe(profiles[3].id)
  })

  it('preserves legitimate views and profile bytes when invalid opens or unknown profiles are rejected', async () => {
    const f = await fixture()
    const a = await f.create()
    const b = await f.create()
    await f.open(a.id)
    await f.open(b.id)
    const files = await fs.readdir(f.root, { recursive: true })
    const metadata = path.join(f.root, String(files.find(file => String(file).endsWith('profiles.json'))))
    const before = await fs.readFile(metadata)

    const rejected = [
      await f.open('invalid-profile-id'),
      await f.open('11111111-1111-1111-1111-111111111111'),
      await f.call('open', { profileId: a.id, target: 'merchant', bounds: { ...bounds, width: -1 } }),
      await f.call('open', { profileId: a.id, target: 'unsupported' as never, bounds }),
      await f.runtime.configure({ sessionId: 'test', action: 'setLimit', maxConcurrentBrowsers: 99 })
    ]

    expect(rejected.map(reply => reply.error)).toEqual([
      'SHOP_PROFILE_INVALID_REQUEST',
      'SHOP_PROFILE_NOT_FOUND',
      'SHOP_PROFILE_INVALID_REQUEST',
      'SHOP_PROFILE_INVALID_REQUEST',
      'SHOP_BROWSER_RUNTIME_INVALID_REQUEST'
    ])
    expect(f.views.every(view => !view.closed)).toBe(true)
    expect((await f.call('list')).openProfileId).toBe(b.id)
    expect((await f.snapshot()).browsers).toHaveLength(2)
    expect(await fs.readFile(metadata)).toEqual(before)
    expect(f.clearStorage).not.toHaveBeenCalled()
  })

  it('ignores a stale browser poll for the previous shop without destroying retained views', async () => {
    const f = await fixture()
    const a = await f.create()
    const b = await f.create()
    await f.open(a.id)
    await f.open(b.id)
    expect((await f.call('browser', { profileId: a.id, browser: { action: 'state' } })).error).toBe(
      'SHOP_PROFILE_NOT_OPEN'
    )
    expect(f.views.every(view => !view.closed)).toBe(true)
    expect((await f.call('list')).openProfileId).toBe(b.id)
  })

  it('keeps screenshot/payment execution connections alive across LRU, lowering the limit and closing all views', async () => {
    const f = await fixture()
    const a = await f.register('10001')
    const task = await f.runtime.acquireExecution(a.id, 'merchant')
    const profileBytesBefore = JSON.stringify((await f.call('list')).profiles)
    await f.setLimit(1)
    const b = await f.create()
    await f.open(b.id)
    expect(f.views[0].closed).toBe(true)
    await task.validate()
    expect(await task.command('root', 'Runtime.evaluate', {})).toEqual({ method: 'Runtime.evaluate' })
    await f.setLimit(3)
    const c = await f.create()
    await f.open(c.id)
    await f.setLimit(1)
    await task.validate()
    expect((await f.runtime.configure({ sessionId: 'test', action: 'closeAll' })).snapshot?.browsers).toEqual([])
    await task.command('root', 'Page.captureScreenshot', {})
    expect(f.executions[0].close).not.toHaveBeenCalled()
    expect(f.clearStorage).not.toHaveBeenCalled()
    expect((await f.call('list')).profiles?.find(profile => profile.id === a.id)).toEqual(
      JSON.parse(profileBytesBefore)[0]
    )
    expect((await f.call('delete', { profileId: a.id })).error).toBe('SHOP_PROFILE_IN_USE')
    await task.close()
    expect(f.executions[0].close).toHaveBeenCalledOnce()
  })

  it('closes only the active view on normal close and every retained view on closeAll', async () => {
    const f = await fixture()
    const a = await f.create()
    const b = await f.create()
    await f.open(a.id)
    await f.open(b.id)
    await f.call('close')
    expect(f.views.map(view => view.closed)).toEqual([false, true])
    await f.runtime.configure({ sessionId: 'test', action: 'closeAll' })
    expect(f.views.every(view => view.closed)).toBe(true)
    expect(f.clearStorage).not.toHaveBeenCalled()
  })

  it.each(['delete', 'relogin'] as const)(
    'closes a hidden shop before explicit %s clears its login storage',
    async action => {
      const f = await fixture()
      const a = await f.create()
      const b = await f.create()
      await f.open(a.id)
      await f.open(b.id)
      expect((await f.call(action, { profileId: a.id })).ok).toBe(true)
      expect(f.views.map(view => view.closed)).toEqual([true, false])
      expect(f.clearStorage).toHaveBeenCalledWith(f.views[0].storage)
      expect(f.events.indexOf(`close:${f.views[0].storage}`)).toBeLessThan(
        f.events.indexOf(`clear:${f.views[0].storage}`)
      )
    }
  )

  it.each(['configure', 'revalidate', 'owner'] as const)(
    'destroys hidden and active views after authority loss through %s',
    async action => {
      const f = await fixture()
      const a = await f.create()
      const b = await f.create()
      await f.open(a.id)
      await f.open(b.id)

      if (action === 'owner') {
        f.changeOwner()
      } else {
        f.revoke()
      }

      if (action === 'revalidate') {
        await f.runtime.revalidate()
      } else {
        expect((await f.runtime.configure({ sessionId: 'test', action: 'snapshot' })).ok).toBe(false)
      }

      expect(f.views.every(view => view.closed)).toBe(true)
      expect(f.clearStorage).not.toHaveBeenCalled()
    }
  )

  it('preserves an unreadable settings file and closes views after a failed native creation', async () => {
    const f = await fixture()
    const a = await f.create()
    const b = await f.create()
    await f.open(a.id)
    f.failCreation()
    expect((await f.open(b.id)).error).toBe('SYNTHETIC_CREATE_FAILED')
    expect(f.views.every(view => view.closed)).toBe(true)
    await f.setLimit(2)
    const settingsFile = path.join(f.root, 'runtime', (await fs.readdir(path.join(f.root, 'runtime')))[0])
    await fs.writeFile(settingsFile, '{broken')
    const restarted = await fixture({ root: f.root })
    expect(
      (await restarted.runtime.configure({ sessionId: 'test', action: 'setLimit', maxConcurrentBrowsers: 4 })).error
    ).toBe('SHOP_BROWSER_RUNTIME_STORE_INVALID')
    expect(await fs.readFile(settingsFile, 'utf8')).toBe('{broken')
  })

  it('reconciles a cloud transfer by closing the hidden revoked view while keeping another shop', async () => {
    const records = new Map<string, CloudShopRecord>()

    const cloud: ShopProfileCloud = {
      list: async () => ({
        profiles: [...records.values()].map(({ session: _session, ...record }) => record),
        hiddenProfileIds: []
      }),
      get: async id => structuredClone(records.get(id)!),
      save: async (profile, revision, session) => {
        const record: CloudShopRecord = {
          profile_id: profile.id,
          revision: revision + 1,
          deleted: false,
          updated_at: new Date().toISOString(),
          servicing_principal_id: initialAuthority.principalId,
          profile: {
            display_name: profile.displayName,
            shop_id: profile.shopId!,
            shop_name: profile.shopName!,
            created_at: profile.createdAt,
            checked_at: profile.checkedAt
          },
          session
        }

        records.set(profile.id, record)

        return record
      },
      hide: async id => {
        records.delete(id)
      }
    }

    const f = await fixture({ cloud })
    const a = await f.register('10001')
    const b = await f.register('10002')
    records.delete(a.id)
    const listing = await f.call('list')
    expect(listing.profiles?.map(profile => profile.id)).toEqual([b.id])
    expect(f.views.map(view => view.closed)).toEqual([true, false])
    expect((await f.snapshot()).browsers.map(browser => browser.profileId)).toEqual([b.id])
    expect(f.clearStorage).toHaveBeenCalledWith(f.views[0].storage)
  })
})
