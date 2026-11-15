import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ShopBrowserBookmarks } from './shop-browser-bookmarks'
import type { ShopBrowserAuthority } from './shop-browser-profiles'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hermes-bookmarks-'))
  roots.push(root)
  let authority: ShopBrowserAuthority = { origin: 'https://enterprise.example', tenantId: 'company', principalId: 'employee' }
  let allowed = true
  let current = true
  const deps = { root, isCurrent: () => current, authorize: async () => {
    if (!allowed) throw new Error('SHOP_PROFILE_ACCESS_UNAVAILABLE')
    return authority
  } }
  return { root, deps, store: new ShopBrowserBookmarks(deps), setAuthority: (next: ShopBrowserAuthority) => { authority = next }, revoke: () => { allowed = false }, disconnect: () => { current = false } }
}

describe('native bookmark operations in a scoped main-process store', () => {
  it('toggles exact URLs, retains native fields and preserves folder child identity', async () => {
    const f = await fixture()
    let state = await f.store.operate({ action: 'toggle', url: 'https://fxg.jinritemai.com/a?q=1', title: '页面一' }, 0)
    const bookmark = state.items[0]
    expect(bookmark).toMatchObject({ Title: '页面一', Url: 'https://fxg.jinritemai.com/a?q=1', IsFolder: false, Children: [] })
    state = await f.store.operate({ action: 'create-folder', title: ' 常用 ' }, state.revision)
    const folderId = state.items[1].Id
    state = await f.store.operate({ action: 'move', id: bookmark.Id, folderId }, state.revision)
    expect(state.items).toHaveLength(1)
    expect(state.items[0].Children).toEqual([bookmark])
    state = await f.store.operate({ action: 'toggle', url: bookmark.Url, title: 'ignored' }, state.revision)
    expect(state.items[0].Children).toHaveLength(0)
    state = await f.store.operate({ action: 'toggle', url: 'https://fxg.jinritemai.com/A?q=1', title: 'Uppercase' }, state.revision)
    state = await f.store.operate({ action: 'toggle', url: bookmark.Url, title: 'Lowercase' }, state.revision)
    expect(state.items.filter(item => !item.IsFolder)).toHaveLength(2)
  })

  it('accepts duplicate folder names, trims names and ignores empty confirmed names', async () => {
    const f = await fixture()
    let state = await f.store.operate({ action: 'create-folder', title: 'same' }, 0)
    state = await f.store.operate({ action: 'create-folder', title: 'same' }, state.revision)
    expect(state.items.map(item => item.Title)).toEqual(['same', 'same'])
    const revision = state.revision
    state = await f.store.operate({ action: 'rename-folder', id: state.items[0].Id, title: '   ' }, revision)
    expect(state.revision).toBe(revision)
    state = await f.store.operate({ action: 'rename-folder', id: state.items[0].Id, title: ' 新名称 ' }, revision)
    expect(state.items[0].Title).toBe('新名称')
  })

  it('requires confirmation only for a nonempty folder and removes its children with it', async () => {
    const f = await fixture()
    let state = await f.store.operate({ action: 'create-folder', title: 'empty' }, 0)
    state = await f.store.operate({ action: 'delete', id: state.items[0].Id }, state.revision)
    expect(state.items).toHaveLength(0)
    state = await f.store.operate({ action: 'create-folder', title: 'used' }, state.revision)
    const folderId = state.items[0].Id
    state = await f.store.operate({ action: 'toggle', url: 'about:blank', title: 'Blank' }, state.revision)
    state = await f.store.operate({ action: 'move', id: state.items[1].Id, folderId }, state.revision)
    await expect(f.store.operate({ action: 'delete', id: folderId }, state.revision)).rejects.toThrow('SHOP_BOOKMARK_CONFIRM_REQUIRED')
    expect((await f.store.operate({ action: 'list' })).items[0].Children).toHaveLength(1)
    state = await f.store.operate({ action: 'delete', id: folderId, confirmed: true }, state.revision)
    expect(state.items).toHaveLength(0)
  })

  it('restores after a new controller and isolates enterprise origin, tenant and employee', async () => {
    const f = await fixture()
    const original = await f.store.operate({ action: 'create-folder', title: 'persisted' }, 0)
    expect(await new ShopBrowserBookmarks(f.deps).operate({ action: 'list' })).toEqual(original)
    for (const authority of [
      { origin: 'https://other.example', tenantId: 'company', principalId: 'employee' },
      { origin: 'https://enterprise.example', tenantId: 'other', principalId: 'employee' },
      { origin: 'https://enterprise.example', tenantId: 'company', principalId: 'other' }
    ]) {
      f.setAuthority(authority)
      expect((await f.store.operate({ action: 'list' })).items).toEqual([])
    }
  })

  it('serializes competing controllers and rejects stale writes with the persisted revision', async () => {
    const f = await fixture()
    const second = new ShopBrowserBookmarks(f.deps)
    const results = await Promise.allSettled([
      f.store.operate({ action: 'create-folder', title: 'one' }, 0),
      second.operate({ action: 'create-folder', title: 'two' }, 0)
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('SHOP_BOOKMARK_CONFLICT')
    expect((await f.store.operate({ action: 'list' })).items).toHaveLength(1)
  })

  it('checks authorization again before commit and removes the temporary write on revocation', async () => {
    const f = await fixture()
    const initial = await f.store.operate({ action: 'create-folder', title: 'kept' }, 0)
    let reads = 0
    const revoked = new ShopBrowserBookmarks({ ...f.deps, authorize: async () => {
      reads += 1
      if (reads > 1) throw new Error('SHOP_PROFILE_ACCESS_UNAVAILABLE')
      return f.deps.authorize()
    } })
    await expect(revoked.operate({ action: 'create-folder', title: 'discarded' }, initial.revision)).rejects.toThrow('SHOP_PROFILE_ACCESS_UNAVAILABLE')
    expect(await f.store.operate({ action: 'list' })).toEqual(initial)
    const directory = path.join(f.root, (await readdir(f.root))[0])
    expect(await readdir(directory)).toEqual(['bookmarks.json'])
    f.disconnect()
    await expect(f.store.operate({ action: 'list' })).rejects.toThrow('SHOP_PROFILE_OWNER_CHANGED')
  })

  it('surfaces a malformed store and preserves its bytes', async () => {
    const f = await fixture()
    await f.store.operate({ action: 'create-folder', title: 'saved' }, 0)
    const file = path.join(f.root, (await readdir(f.root))[0], 'bookmarks.json')
    await writeFile(file, '{broken')
    await expect(f.store.operate({ action: 'create-folder', title: 'new' }, 1)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{broken')
  })

  it('rejects unsupported menu fields, URL schemes and cross-folder moves', async () => {
    const f = await fixture()
    await expect(f.store.operate({ action: 'toggle', url: 'file:///C:/secret', title: 'local' }, 0)).rejects.toThrow('SHOP_BOOKMARK_INVALID')
    await expect(f.store.operate({ action: 'list', title: 'ignored' })).rejects.toThrow('SHOP_BOOKMARK_INVALID')
    await expect(f.store.operate({ action: 'move', id: 'unknown', folderId: 'unknown' }, 0)).rejects.toThrow('SHOP_BOOKMARK_NOT_FOUND')
    expect((await f.store.operate({ action: 'list' })).revision).toBe(0)
  })
})
