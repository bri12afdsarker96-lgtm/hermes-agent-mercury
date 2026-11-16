import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { ShopBrowserProfiles } from './shop-browser-profiles'
import type { ShopBrowserDependencies, ShopBrowserView } from './shop-browser-profiles'
import type {
  ShopBrowserRuntimeReply,
  ShopBrowserRuntimeRequest,
  ShopBrowserRuntimeSnapshot
} from './shop-browser-runtime-types'
import type { ShopBrowserBounds, ShopBrowserReply, ShopBrowserRequest } from './shop-browser-types'
import { recoverableShopBrowserErrors } from './shop-browser-types'

const recoverableErrors = new Set<string>([...recoverableShopBrowserErrors, 'SHOP_BROWSER_RUNTIME_INVALID_REQUEST'])
type Entry = {
  profileId: string
  storage: string
  target: 'merchant' | 'feige'
  view: ShopBrowserView
  active: boolean
  lastUsed: number
  lease: number
  closing?: Promise<void>
}

/** Keeps native browser workspaces alive across shop switches. Reception state
 * remains authoritative in the message service, which this client lacks. */
export class ShopBrowserRuntime {
  private profiles: ShopBrowserProfiles
  private entries = new Map<string, Entry>()
  private tail: Promise<unknown> = Promise.resolve()
  private invalidated = false
  private ownerKey?: string
  private settingsFile?: string
  private maximum = 3
  private sequence = 0
  private opening?: { profileId: string }

  constructor(private deps: ShopBrowserDependencies) {
    this.profiles = new ShopBrowserProfiles({
      ...deps,
      createView: (storage, target, bounds) => this.acquireView(storage, target, bounds),
      clearStorage: async storage => {
        await Promise.all(
          [...this.entries.values()].filter(entry => entry.storage === storage).map(entry => this.destroy(entry))
        )
        await deps.clearStorage(storage)
      }
    })
  }

  private assertCurrent() {
    if (this.invalidated || !this.deps.isCurrent()) {
      throw new Error('SHOP_PROFILE_OWNER_CHANGED')
    }
  }

  private async loadSettings() {
    this.assertCurrent()
    const authority = await this.deps.authorize()
    this.assertCurrent()

    if (!authority.origin || !authority.tenantId || !authority.principalId) {
      throw new Error('SHOP_PROFILE_FORBIDDEN')
    }

    const key = createHash('sha256')
      .update(JSON.stringify([authority.origin, authority.tenantId, authority.principalId]))
      .digest('hex')

    if (this.ownerKey && this.ownerKey !== key) {
      this.invalidate()
      throw new Error('SHOP_PROFILE_OWNER_CHANGED')
    }

    if (this.settingsFile) {
      return
    }

    this.ownerKey = key
    const file = path.join(this.deps.root, 'runtime', `${key}.json`)
    let settings: { version: number; maxConcurrentBrowsers: number }

    try {
      settings = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('SHOP_BROWSER_RUNTIME_STORE_INVALID')
      }

      settings = { version: 1, maxConcurrentBrowsers: 3 }
    }

    this.assertCurrent()

    if (settings?.version !== 1 || !this.validLimit(settings.maxConcurrentBrowsers)) {
      throw new Error('SHOP_BROWSER_RUNTIME_STORE_INVALID')
    }

    this.maximum = settings.maxConcurrentBrowsers
    this.settingsFile = file
  }

  private validLimit(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10
  }

  private async saveLimit(value: number) {
    await fs.mkdir(path.dirname(this.settingsFile!), { recursive: true })
    const temporary = `${this.settingsFile}.${randomUUID()}.tmp`

    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, maxConcurrentBrowsers: value }), {
        flag: 'wx',
        mode: 0o600
      })
      this.assertCurrent()
      await fs.rename(temporary, this.settingsFile!)
      this.maximum = value
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  private destroy(entry: Entry): Promise<void> {
    entry.closing ??= (async () => {
      await entry.view.close()

      if (this.entries.get(entry.profileId) === entry) {
        this.entries.delete(entry.profileId)
      }
    })()

    return entry.closing.catch(error => {
      entry.closing = undefined
      throw error
    })
  }

  private async trim(limit: number) {
    while (this.entries.size > limit) {
      const oldest = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0]
      await this.destroy(oldest)
    }
  }

  private async acquireView(
    storage: string,
    target: 'merchant' | 'feige',
    bounds: ShopBrowserBounds
  ): Promise<ShopBrowserView> {
    this.assertCurrent()

    if (!this.opening) {
      throw new Error('SHOP_BROWSER_RUNTIME_INVALID_REQUEST')
    }

    const profileId = this.opening.profileId
    let entry = this.entries.get(profileId)

    if (entry && (entry.storage !== storage || entry.target !== target)) {
      await this.destroy(entry)
      entry = undefined
    }

    if (!entry) {
      await this.trim(this.maximum - 1)
      const view = await this.deps.createView(storage, target, bounds)

      try {
        this.assertCurrent()
      } catch (error) {
        await view.close()
        throw error
      }

      entry = { profileId, storage, target, view, active: false, lastUsed: 0, lease: 0 }
      this.entries.set(profileId, entry)
    }

    const retained = entry
    const lease = ++retained.lease
    retained.lastUsed = ++this.sequence
    retained.active = true
    retained.view.setBounds(bounds)

    if (retained.view.workspace) {
      await retained.view.workspace.operate({ action: 'suspend', value: false })
    }

    return {
      workspace: retained.view.workspace,
      identify: () => retained.view.identify(),
      setBounds: next => retained.view.setBounds(next),
      close: async () => {
        if (retained.lease !== lease || this.entries.get(profileId) !== retained) {
          return
        }

        retained.active = false

        if (this.opening && !this.invalidated && this.deps.isCurrent() && retained.view.workspace) {
          await retained.view.workspace.operate({ action: 'suspend', value: true })
        } else {
          await this.destroy(retained)
        }
      }
    }
  }

  private snapshot(): ShopBrowserRuntimeSnapshot {
    return {
      maxConcurrentBrowsers: this.maximum,
      browsers: [...this.entries.values()].map(({ profileId, target, active, lastUsed }) => ({
        profileId,
        target,
        active,
        lastUsed
      })),
      receptionControl: { available: false, error: 'SHOP_RECEPTION_SERVICE_UNAVAILABLE' }
    }
  }

  private async reconcile(reply: ShopBrowserReply) {
    if (!reply.ok && !recoverableErrors.has(reply.error ?? '')) {
      await this.closeAll()
    } else if (reply.profiles) {
      const visible = new Set(reply.profiles.map(profile => profile.id))
      await Promise.all(
        [...this.entries.values()].filter(entry => !visible.has(entry.profileId)).map(entry => this.destroy(entry))
      )
    }
  }

  private closeAll() {
    return Promise.all([...this.entries.values()].map(entry => this.destroy(entry)))
  }

  private async reject(error: unknown) {
    const code = error instanceof Error ? error.message : 'SHOP_BROWSER_RUNTIME_FAILED'

    if (!recoverableErrors.has(code)) {
      await this.closeAll().catch(() => {})
    }

    return { ok: false, error: code }
  }

  operate(request: ShopBrowserRequest): Promise<ShopBrowserReply> {
    const operation = this.tail
      .then(async () => {
        await this.loadSettings()

        if (request?.action === 'open') {
          const listing = await this.profiles.operate({ sessionId: request.sessionId, action: 'list' })
          await this.reconcile(listing)

          if (!listing.ok) {
            return listing
          }

          this.opening = { profileId: request.profileId! }
        }

        let reply: ShopBrowserReply

        try {
          reply = await this.profiles.operate(request)
        } finally {
          this.opening = undefined
        }

        await this.reconcile(reply)

        return reply
      })
      .catch(async error => {
        this.opening = undefined

        return this.reject(error)
      })

    this.tail = operation

    return operation
  }

  configure(request: ShopBrowserRuntimeRequest): Promise<ShopBrowserRuntimeReply> {
    const operation = this.tail
      .then(async () => {
        const allowed =
          request?.action === 'setLimit' ? ['sessionId', 'action', 'maxConcurrentBrowsers'] : ['sessionId', 'action']

        if (
          !['snapshot', 'setLimit', 'closeAll'].includes(request?.action) ||
          Object.keys(request).some(key => !allowed.includes(key)) ||
          (request.action === 'setLimit' && !this.validLimit(request.maxConcurrentBrowsers))
        ) {
          throw new Error('SHOP_BROWSER_RUNTIME_INVALID_REQUEST')
        }

        await this.loadSettings()
        const listing = await this.profiles.operate({ sessionId: request.sessionId, action: 'list' })
        await this.reconcile(listing)

        if (!listing.ok) {
          return { ok: false, error: listing.error }
        }

        if (request.action === 'setLimit') {
          await this.trim(request.maxConcurrentBrowsers!)
          await this.saveLimit(request.maxConcurrentBrowsers!)
        }

        if (request.action === 'closeAll') {
          await this.profiles.operate({ sessionId: request.sessionId, action: 'close' })
          await this.closeAll()
        }

        this.assertCurrent()

        return { ok: true, snapshot: this.snapshot() }
      })
      .catch(error => this.reject(error))

    this.tail = operation

    return operation
  }

  acquireExecution(...args: Parameters<ShopBrowserProfiles['acquireExecution']>) {
    return this.profiles.acquireExecution(...args)
  }

  revalidate() {
    const operation = this.tail
      .then(async () => {
        await this.profiles.revalidate()

        if (this.entries.size) {
          const listing = await this.profiles.operate({ sessionId: '', action: 'list' })
          await this.reconcile(listing)
        }
      })
      .catch(async () => {
        await this.closeAll().catch(() => {})
      })

    this.tail = operation

    return operation
  }

  invalidate() {
    this.invalidated = true
    this.profiles.invalidate()

    for (const entry of this.entries.values()) {
      try {
        entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      } catch {
        // A destroyed native view must not interrupt the remaining cleanup.
      }
    }

    void this.closeAll().catch(() => {})
  }
}
