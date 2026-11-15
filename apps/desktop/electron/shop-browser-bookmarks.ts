import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { ShopBrowserAuthority } from './shop-browser-profiles'
import type { NativeBookmarkItem, ShopBookmarkCommand, ShopBookmarkSnapshot } from './shop-browser-workspace-types'
import { isBrowserNavigationUrl } from './shop-browser-workspace-types'

interface Store extends ShopBookmarkSnapshot {
  version: 1
}
interface Dependencies {
  root: string
  authorize(): Promise<ShopBrowserAuthority>
  isCurrent(): boolean
}
const queues = new Map<string, Promise<unknown>>()
const scopeKey = (scope: ShopBrowserAuthority) => JSON.stringify([scope.origin, scope.tenantId, scope.principalId])

const fail = (code: string): never => {
  throw new Error(code)
}

/** Native BookmarkItem fields and one-folder UI operations. Hermes scopes the
 * shared local file to an enterprise employee and commits atomically. */
export class ShopBrowserBookmarks {
  constructor(private deps: Dependencies) {}

  private current() {
    if (!this.deps.isCurrent()) {fail('SHOP_PROFILE_OWNER_CHANGED')}
  }

  private async read(file: string): Promise<Store> {
    let raw: string

    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return { version: 1, revision: 0, items: [] }}
      throw error
    }

    const store = JSON.parse(raw) as Store
    const ids = new Set<string>()

    const validItems = (items: NativeBookmarkItem[]): boolean =>
      Array.isArray(items) &&
      items.every(item => {
        if (
          !item ||
          typeof item.Id !== 'string' ||
          ids.has(item.Id) ||
          typeof item.Title !== 'string' ||
          typeof item.Url !== 'string' ||
          typeof item.IsFolder !== 'boolean' ||
          typeof item.CreateTime !== 'string' ||
          !Number.isFinite(Date.parse(item.CreateTime))
        )
          {return false}

        ids.add(item.Id)

        return validItems(item.Children)
      })

    if (store.version !== 1 || !Number.isSafeInteger(store.revision) || store.revision < 0 || !validItems(store.items))
      {fail('SHOP_BOOKMARK_STORE_INVALID')}

    return store
  }

  operate(command: ShopBookmarkCommand, expectedRevision?: number): Promise<ShopBookmarkSnapshot> {
    const previous = queues.get(this.deps.root) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(() => this.perform(command, expectedRevision))
    queues.set(this.deps.root, operation)
    void operation
      .finally(() => {
        if (queues.get(this.deps.root) === operation) {queues.delete(this.deps.root)}
      })
      .catch(() => {})

    return operation
  }

  private async perform(command: ShopBookmarkCommand, expectedRevision?: number): Promise<ShopBookmarkSnapshot> {
    this.current()
    const scope = await this.deps.authorize()
    this.current()
    const directory = path.join(this.deps.root, createHash('sha256').update(scopeKey(scope)).digest('hex'))
    const file = path.join(directory, 'bookmarks.json')
    const store = await this.read(file)

    const fields: Record<string, string[]> = {
      list: [],
      toggle: ['url', 'title'],
      'create-folder': ['title'],
      'rename-folder': ['id', 'title'],
      move: ['id', 'folderId'],
      delete: ['id', 'confirmed']
    }

    const allowed = fields[command?.action]

    if (!allowed || Object.keys(command).some(key => !['action', ...allowed].includes(key)))
      {fail('SHOP_BOOKMARK_INVALID')}

    if (command.action === 'list') {return { revision: store.revision, items: store.items }}

    if (expectedRevision !== store.revision) {fail('SHOP_BOOKMARK_CONFLICT')}

    const remove = (id: string) => {
      const root = store.items.findIndex(item => item.Id === id)

      if (root >= 0) {return store.items.splice(root, 1)[0]}

      for (const folder of store.items.filter(item => item.IsFolder)) {
        const index = folder.Children.findIndex(item => item.Id === id)

        if (index >= 0) {return folder.Children.splice(index, 1)[0]}
      }

      return fail('SHOP_BOOKMARK_NOT_FOUND')
    }

    if (command.action === 'toggle') {
      if (!isBrowserNavigationUrl(command.url) || typeof command.title !== 'string') {fail('SHOP_BOOKMARK_INVALID')}

      const existing = store.items
        .flatMap(item => (item.IsFolder ? item.Children : [item]))
        .find(item => item.Url === command.url)

      if (existing) {remove(existing.Id)}
      else
        {store.items.push({
          Id: randomUUID(),
          Title: command.title,
          Url: command.url,
          IsFolder: false,
          Children: [],
          CreateTime: new Date().toISOString()
        })}
    }

    if (command.action === 'create-folder' || command.action === 'rename-folder') {
      if (typeof command.title !== 'string') {fail('SHOP_BOOKMARK_INVALID')}
      const title = command.title.trim()

      if (!title) {return { revision: store.revision, items: store.items }}

      if (command.action === 'create-folder')
        {store.items.push({
          Id: randomUUID(),
          Title: title,
          Url: '',
          IsFolder: true,
          Children: [],
          CreateTime: new Date().toISOString()
        })}
      else {
        const folder = store.items.find(item => item.Id === command.id && item.IsFolder)

        if (!folder) {fail('SHOP_BOOKMARK_NOT_FOUND')}
        folder.Title = title
      }
    }

    if (command.action === 'move') {
      const item = store.items.find(item => item.Id === command.id && !item.IsFolder)
      const folder = store.items.find(item => item.Id === command.folderId && item.IsFolder)

      if (!item || !folder) {fail('SHOP_BOOKMARK_NOT_FOUND')}
      remove(item.Id)
      folder.Children.push(item)
    }

    if (command.action === 'delete') {
      if (typeof command.id !== 'string') {fail('SHOP_BOOKMARK_INVALID')}
      const item = store.items.find(item => item.Id === command.id)

      if (item?.IsFolder && item.Children.length && command.confirmed !== true) {fail('SHOP_BOOKMARK_CONFIRM_REQUIRED')}
      remove(command.id)
    }

    store.revision += 1
    await fs.mkdir(directory, { recursive: true })
    const temporary = path.join(directory, `${randomUUID()}.tmp`)

    try {
      await fs.writeFile(temporary, JSON.stringify(store, null, 2), { flag: 'wx', mode: 0o600 })
      const current = await this.deps.authorize()
      this.current()

      if (scopeKey(current) !== scopeKey(scope)) {fail('SHOP_PROFILE_OWNER_CHANGED')}
      await fs.rename(temporary, file)
    } finally {
      await fs.rm(temporary, { force: true })
    }

    return { revision: store.revision, items: store.items }
  }
}
