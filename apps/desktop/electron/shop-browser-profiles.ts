import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { ShopBrowserBookmarks } from './shop-browser-bookmarks'
import type { PortableShopSession, ShopProfileCloud } from './shop-browser-cloud'
import type { BoundShopExecution, ShopExecutionTransport } from './shop-browser-execution'
import type { ShopBrowserBounds, ShopBrowserProfile, ShopBrowserReply, ShopBrowserRequest } from './shop-browser-types'
import { recoverableShopBrowserErrors } from './shop-browser-types'
import type { ShopBrowserPageControls, ShopBrowserWorkspace } from './shop-browser-workspace-types'

export interface ShopBrowserAuthority {
  origin: string
  tenantId: string
  principalId: string
}
interface StoredProfile extends ShopBrowserProfile {
  storageId: string
  storageLayout?: 2
  cloudRevision?: number
}
export interface ShopBrowserView {
  identify(): Promise<{ shopId: string; shopName: string } | null>
  setBounds(bounds: ShopBrowserBounds): void
  close(): Promise<void>
  browser?: ShopBrowserPageControls
  workspace?: ShopBrowserWorkspace
}
export interface ShopBrowserDependencies {
  root: string
  authorize(): Promise<ShopBrowserAuthority>
  isCurrent(): boolean
  createView(storagePath: string, target: 'merchant' | 'feige', bounds: ShopBrowserBounds): Promise<ShopBrowserView>
  clearStorage(storagePath: string): Promise<void>
  createExecution?(storagePath: string, target: 'merchant' | 'feige'): Promise<ShopExecutionTransport>
  cloud?: ShopProfileCloud
  exportSession?(storagePath: string): Promise<PortableShopSession>
  importSession?(storagePath: string, session: PortableShopSession): Promise<void>
}

const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

const publicProfile = (profile: StoredProfile): ShopBrowserProfile => ({
  id: profile.id,
  displayName: profile.displayName,
  tenantId: profile.tenantId,
  principalId: profile.principalId,
  shopId: profile.shopId,
  shopName: profile.shopName,
  createdAt: profile.createdAt,
  checkedAt: profile.checkedAt,
  loginState: profile.loginState
})

const scopeKey = (scope: ShopBrowserAuthority) =>
  digest(JSON.stringify([scope.origin, scope.tenantId, scope.principalId]))

const fail = (code: string): never => {
  throw new Error(code)
}

export function validShopBounds(value: unknown): value is ShopBrowserBounds {
  const bounds = value as ShopBrowserBounds

  return (
    !!bounds &&
    Object.keys(bounds).length === 4 &&
    ['x', 'y', 'width', 'height'].every(key => Number.isInteger(bounds[key as keyof ShopBrowserBounds])) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width >= 0 &&
    bounds.height >= 0 &&
    bounds.x + bounds.width <= 20000 &&
    bounds.y + bounds.height <= 20000
  )
}

/** Main-owned profile metadata and browser lifetime, fenced to one enterprise session. */
export class ShopBrowserProfiles {
  private tail: Promise<unknown> = Promise.resolve()
  private scope?: ShopBrowserAuthority
  private invalidated = false
  private opened?: { id: string; view: ShopBrowserView }
  private executions = new Set<BoundShopExecution>()
  private bookmarks: ShopBrowserBookmarks
  private cloudStatus?: ShopBrowserReply['cloud']
  private nextCloudCheck = 0
  private nextCloudBackup = 0
  private cloudReady = false
  private cloudAccess?: { profiles: Awaited<ReturnType<ShopProfileCloud['list']>>; expiresAt: number }
  private cloudAccessRequest?: Promise<Awaited<ReturnType<ShopProfileCloud['list']>>>
  private revokedProfiles = new Set<string>()

  constructor(private deps: ShopBrowserDependencies) {
    this.bookmarks = new ShopBrowserBookmarks({
      root: deps.root,
      authorize: () => this.authority(),
      isCurrent: () => !this.invalidated && deps.isCurrent()
    })
  }

  private assertCurrent() {
    if (this.invalidated || !this.deps.isCurrent()) {
      fail('SHOP_PROFILE_OWNER_CHANGED')
    }
  }

  private async authority() {
    this.assertCurrent()
    const current = await this.deps.authorize()
    this.assertCurrent()

    if (!current.origin || !current.tenantId || !current.principalId) {
      fail('SHOP_PROFILE_FORBIDDEN')
    }

    if (this.scope && scopeKey(this.scope) !== scopeKey(current)) {
      this.invalidate()
      fail('SHOP_PROFILE_OWNER_CHANGED')
    }

    this.scope = current

    return current
  }

  private directory(scope: ShopBrowserAuthority) {
    return path.join(this.deps.root, scopeKey(scope))
  }

  private async read(scope: ShopBrowserAuthority): Promise<StoredProfile[]> {
    let raw: string

    try {
      raw = await fs.readFile(path.join(this.directory(scope), 'profiles.json'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }

      throw error
    }

    const data = JSON.parse(raw)

    if (data.version !== 1 || !Array.isArray(data.profiles)) {
      fail('SHOP_PROFILE_STORE_INVALID')
    }

    const profiles = data.profiles as StoredProfile[]
    const ids = new Set<string>()

    for (const profile of profiles) {
      if (
        !uuid(profile.id) ||
        !uuid(profile.storageId) ||
        ids.has(profile.id) ||
        profile.tenantId !== scope.tenantId ||
        profile.principalId !== scope.principalId ||
        typeof profile.displayName !== 'string' ||
        !['unverified', 'verified', 'expired'].includes(profile.loginState) ||
        (profile.shopId !== null && !/^\d{1,32}$/.test(profile.shopId)) ||
        (profile.shopName !== null && typeof profile.shopName !== 'string') ||
        (profile.storageLayout !== undefined && profile.storageLayout !== 2) ||
        (profile.cloudRevision !== undefined &&
          (!Number.isSafeInteger(profile.cloudRevision) || profile.cloudRevision < 1))
      ) {
        fail('SHOP_PROFILE_STORE_INVALID')
      }

      ids.add(profile.id)
    }

    return profiles
  }

  private async save(scope: ShopBrowserAuthority, profiles: StoredProfile[]) {
    this.assertCurrent()
    const directory = this.directory(scope)
    await fs.mkdir(directory, { recursive: true })
    const temporary = path.join(directory, `${randomUUID()}.tmp`)

    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, profiles }, null, 2), { flag: 'wx', mode: 0o600 })
      this.assertCurrent()
      await fs.rename(temporary, path.join(directory, 'profiles.json'))
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  private storage(scope: ShopBrowserAuthority, profile: StoredProfile) {
    // Limit Chromium journal path lengths on Windows while preserving old sessions.
    if (profile.storageLayout === 2) {
      return path.join(
        this.deps.root,
        'sessions',
        digest(JSON.stringify([scopeKey(scope), profile.id, profile.storageId]))
      )
    }

    return path.join(this.directory(scope), 'sessions', profile.id, profile.storageId)
  }

  private async closeView(backup = true) {
    const opened = this.opened

    try {
      if (backup && opened && this.deps.cloud && !this.invalidated && this.deps.isCurrent()) {
        const scope = await this.authority()
        const profiles = await this.read(scope)
        const profile = profiles.find(profile => profile.id === opened.id)

        if (profile?.loginState === 'verified') {
          await this.backup(scope, profiles, profile)
        }
      }
    } catch {
      // A failed backup must not prevent detaching a stale native page.
    } finally {
      this.opened = undefined

      if (opened) {
        await opened.view.close()
      }
    }
  }

  private async cloudListing(force = false) {
    if (!this.deps.cloud) {
      fail('SHOP_CLOUD_UNAVAILABLE')
    }

    if (!force && this.cloudAccess && Date.now() < this.cloudAccess.expiresAt) {
      return this.cloudAccess.profiles
    }

    if (this.cloudAccessRequest) {
      return this.cloudAccessRequest
    }

    const request = this.deps
      .cloud!.list()
      .then(async listing => {
        await this.authority()
        this.cloudAccess = { profiles: listing, expiresAt: Date.now() + 15000 }

        return listing
      })
      .catch(error => {
        this.cloudAccess = undefined
        throw error
      })
      .finally(() => {
        this.cloudAccessRequest = undefined
      })

    this.cloudAccessRequest = request

    return request
  }

  private async checkProfileAccess(profile: StoredProfile, force = false) {
    if (!profile.cloudRevision) {
      return
    }

    if (this.revokedProfiles.has(profile.id)) {
      fail('SHOP_PROFILE_FORBIDDEN')
    }

    let listing: Awaited<ReturnType<ShopProfileCloud['list']>>

    try {
      listing = await this.cloudListing(force)
    } catch {
      fail('SHOP_PROFILE_ACCESS_UNAVAILABLE')
    }

    if (
      listing!.hiddenProfileIds.includes(profile.id) ||
      !listing!.profiles.some(item => item.profile_id === profile.id && !item.deleted)
    ) {
      this.revokedProfiles.add(profile.id)
      fail('SHOP_PROFILE_FORBIDDEN')
    }
  }

  private async backup(scope: ShopBrowserAuthority, profiles: StoredProfile[], profile: StoredProfile) {
    if (!this.deps.cloud || !this.deps.exportSession || !profile.shopId || !profile.shopName) {
      return
    }

    try {
      await this.authority()
      await this.checkProfileAccess(profile, true)

      if (!this.cloudReady) {
        await this.deps.cloud.list()
        await this.authority()
        this.cloudReady = true
      }

      if (this.opened?.id === profile.id) {
        const identity = await this.opened.view.identify()
        await this.authority()

        if (!identity || identity.shopId !== profile.shopId || identity.shopName !== profile.shopName) {
          profile.loginState = 'expired'
          await this.save(scope, profiles)
          throw new Error('SHOP_PROFILE_IDENTITY_CHANGED')
        }
      }

      const session = await this.deps.exportSession(this.storage(scope, profile))
      await this.authority()

      if (profile.cloudRevision) {
        const previous = await this.deps.cloud.get(profile.id)

        if (previous.revision !== profile.cloudRevision || previous.deleted) {
          throw new Error('SHOP_CLOUD_CONFLICT')
        }

        const origins = new Map(previous.session!.origins.map(item => [item.origin, item]))
        session.origins.forEach(item => origins.set(item.origin, item))
        session.origins = [...origins.values()]
      }

      const saved = await this.deps.cloud.save(publicProfile(profile), profile.cloudRevision ?? 0, session)
      await this.authority()
      profile.cloudRevision = saved.revision
      await this.save(scope, profiles)
      this.cloudStatus = { state: 'synced', checkedAt: new Date().toISOString() }
      this.nextCloudCheck = 0
    } catch (error) {
      this.assertCurrent()
      this.cloudStatus = {
        state: /CONFLICT|409|revision_conflict/.test(error instanceof Error ? error.message : '')
          ? 'conflict'
          : 'unavailable',
        checkedAt: new Date().toISOString()
      }

      if (this.cloudStatus.state === 'unavailable') {
        this.cloudReady = false
      }
    }
  }

  private async syncCloud(scope: ShopBrowserAuthority, profiles: StoredProfile[], force = false) {
    if (
      !this.deps.cloud ||
      !this.deps.importSession ||
      !this.deps.createExecution ||
      (!force && Date.now() < this.nextCloudCheck)
    ) {
      return profiles
    }

    this.nextCloudCheck = Date.now() + 30000

    try {
      const { profiles: records, hiddenProfileIds } = await this.cloudListing(true)
      await this.authority()
      this.cloudReady = true
      const visibleIds = new Set(records.filter(record => !record.deleted).map(record => record.profile_id))

      for (const local of profiles.filter(
        profile => profile.cloudRevision && !visibleIds.has(profile.id) && !hiddenProfileIds.includes(profile.id)
      )) {
        this.revokedProfiles.add(local.id)

        if (this.opened?.id === local.id) {
          await this.closeView(false)
        }

        for (const execution of this.executions) {
          if (execution.profileId === local.id) {
            await execution.close()
          }
        }

        await this.deps.clearStorage(this.storage(scope, local))
        await this.authority()
        profiles = profiles.filter(profile => profile.id !== local.id)
        await this.save(scope, profiles)
      }

      for (const id of hiddenProfileIds) {
        const local = profiles.find(profile => profile.id === id)

        if (!local) {
          continue
        }

        if ([...this.executions].some(item => item.profileId === id)) {
          this.nextCloudCheck = 0

          continue
        }

        if (this.opened?.id === id) {
          local.loginState = 'unverified'
          await this.save(scope, profiles)
          await this.closeView()
        }

        await this.deps.clearStorage(this.storage(scope, local))
        await this.authority()
        profiles = profiles.filter(profile => profile.id !== id)
        await this.save(scope, profiles)
      }

      for (const remote of records) {
        if (!remote.deleted) {
          this.revokedProfiles.delete(remote.profile_id)
        }

        const local = profiles.find(profile => profile.id === remote.profile_id)

        if (
          this.opened?.id === remote.profile_id ||
          [...this.executions].some(item => item.profileId === remote.profile_id)
        ) {
          continue
        }

        if (local && (local.cloudRevision ?? 0) >= remote.revision) {
          continue
        }

        if (remote.deleted) {
          if (local) {
            await this.deps.clearStorage(this.storage(scope, local))
            await this.authority()
            profiles = profiles.filter(profile => profile.id !== local.id)
            await this.save(scope, profiles)
          }

          continue
        }

        const detail = await this.deps.cloud.get(remote.profile_id)
        await this.authority()

        if (detail.deleted) {
          this.nextCloudCheck = 0

          continue
        }

        const data = detail.profile!

        const restored: StoredProfile = {
          id: detail.profile_id,
          storageId: randomUUID(),
          storageLayout: 2,
          tenantId: scope.tenantId,
          principalId: scope.principalId,
          displayName: data.display_name,
          shopId: data.shop_id,
          shopName: data.shop_name,
          createdAt: data.created_at,
          checkedAt: null,
          loginState: 'unverified',
          cloudRevision: detail.revision
        }

        const storage = this.storage(scope, restored)

        try {
          await fs.mkdir(storage, { recursive: true })
          await this.deps.importSession(storage, detail.session!)
          await this.authority()
          const check = await this.deps.createExecution(storage, 'merchant')

          try {
            const identity = await check.identify()
            await this.authority()
            restored.loginState =
              identity?.shopId === restored.shopId && identity.shopName === restored.shopName ? 'verified' : 'expired'
            restored.checkedAt = new Date().toISOString()
          } finally {
            await check.close()
          }

          await this.checkProfileAccess(restored, true)
          profiles = [...profiles.filter(profile => profile.id !== restored.id), restored]
          await this.save(scope, profiles)

          if (local) {
            await this.deps.clearStorage(this.storage(scope, local)).catch(() => {})
          }
        } catch (error) {
          await this.deps.clearStorage(storage).catch(() => {})
          throw error
        }
      }

      this.cloudStatus = { state: 'synced', checkedAt: new Date().toISOString() }
      const remoteIds = new Set(records.map(record => record.profile_id))

      for (const local of profiles.filter(
        profile => profile.loginState === 'verified' && !profile.cloudRevision && !remoteIds.has(profile.id)
      )) {
        await this.backup(scope, profiles, local)
      }
    } catch (error) {
      this.assertCurrent()
      this.cloudReady = false
      this.cloudStatus = {
        state: /CONFLICT|409|revision_conflict/.test(error instanceof Error ? error.message : '')
          ? 'conflict'
          : 'unavailable',
        checkedAt: new Date().toISOString()
      }
    }

    return profiles
  }

  invalidate() {
    this.invalidated = true
    // Detaching is immediate even when an identify request is still in flight.
    void this.closeView().catch(() => {})

    for (const execution of this.executions) {
      void execution.close().catch(() => {})
    }
  }

  async revalidate() {
    if (!this.opened && this.executions.size === 0) {
      return
    }

    const operation = this.tail.then(async () => {
      try {
        const scope = await this.authority()
        const profiles = await this.syncCloud(scope, await this.read(scope), true)

        for (const execution of this.executions) {
          const profile = profiles.find(profile => profile.id === execution.profileId)

          if (profile) {
            await this.checkProfileAccess(profile)
          }
        }

        if (this.opened) {
          const profile = profiles.find(profile => profile.id === this.opened!.id)

          if (profile) {
            await this.checkProfileAccess(profile)
          }
        }

        if (this.deps.cloud && this.opened && Date.now() >= this.nextCloudBackup) {
          this.nextCloudBackup = Date.now() + 300000
          const profile = profiles.find(profile => profile.id === this.opened?.id)

          if (profile?.loginState === 'verified') {
            await this.backup(scope, profiles, profile)
          }
        }
      } catch {
        await this.closeView(false)
        await Promise.all([...this.executions].map(execution => execution.close()))
      }
    })

    this.tail = operation.catch(() => {})
    await operation
  }

  acquireExecution(profileId: string, target: 'merchant' | 'feige'): Promise<BoundShopExecution> {
    const operation = this.tail.then(async () => {
      if (!uuid(profileId) || !this.deps.createExecution) {
        fail('SHOP_PROFILE_INVALID_REQUEST')
      }

      const scope = await this.authority()
      const profile = (await this.read(scope)).find(item => item.id === profileId)

      if (!profile || profile.loginState !== 'verified' || !profile.shopId || !profile.shopName) {
        fail('SHOP_PROFILE_UNVERIFIED')
      }

      await this.checkProfileAccess(profile!, true)

      if ([...this.executions].some(item => item.profileId === profileId)) {
        fail('SHOP_PROFILE_IN_USE')
      }

      const transport = await this.deps.createExecution(this.storage(scope, profile), target)
      let released = false

      const execution: BoundShopExecution = {
        connectionId: randomUUID().replaceAll('-', ''),
        profileId,
        shopId: profile.shopId,
        shopName: profile.shopName,
        identify: async () => {
          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

          await this.checkProfileAccess(profile!)
          const identity = await transport.identify()

          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

          return identity
        },
        command: async (targetId, method, params) => {
          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

          await this.checkProfileAccess(profile!)
          const result = await transport.command(targetId, method, params)

          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

          return result
        },
        validate: async () => {
          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

          await this.authority()
          await this.checkProfileAccess(profile!, true)
          const identity = await transport.identify()
          await this.authority()

          if (!identity || identity.shopId !== profile.shopId || identity.shopName !== profile.shopName) {
            fail('SHOP_PROFILE_IDENTITY_CHANGED')
          }
        },
        close: async () => {
          if (released) {
            return
          }

          released = true

          try {
            await transport.close()
          } finally {
            this.executions.delete(execution)
          }

          if (!this.invalidated && this.deps.isCurrent() && this.deps.cloud) {
            const backup = this.tail.then(async () => {
              const owner = await this.authority()
              const profiles = await this.read(owner)
              const profile = profiles.find(profile => profile.id === profileId)

              if (profile?.loginState === 'verified' && !this.revokedProfiles.has(profileId)) {
                await this.backup(owner, profiles, profile)
              }
            })

            this.tail = backup.catch(() => {})
          }
        }
      }

      this.executions.add(execution)

      try {
        await execution.validate()

        return execution
      } catch (error) {
        await execution.close()
        throw error
      }
    })

    this.tail = operation.catch(() => {})

    return operation
  }

  operate(request: ShopBrowserRequest): Promise<ShopBrowserReply> {
    const operation = this.tail
      .then(() => this.perform(request))
      .catch(async error => {
        const code = error instanceof Error ? error.message : 'SHOP_PROFILE_FAILED'

        if (!(recoverableShopBrowserErrors as readonly string[]).includes(code)) {
          await this.closeView().catch(() => {})
        }

        return { ok: false, error: code }
      })

    this.tail = operation

    return operation
  }

  private async perform(request: ShopBrowserRequest): Promise<ShopBrowserReply> {
    this.assertCurrent()

    const fields: Record<string, string[]> = {
      list: [],
      create: [],
      open: ['profileId', 'target', 'bounds'],
      identify: ['profileId'],
      close: [],
      relogin: ['profileId'],
      delete: ['profileId'],
      bounds: ['profileId', 'bounds'],
      browser: ['profileId', 'browser'],
      bookmarks: ['profileId', 'bookmark', 'expectedRevision']
    }

    const allowed = fields[request?.action]

    if (
      !allowed ||
      Object.keys(request).some(key => !['sessionId', 'action', ...allowed].includes(key)) ||
      (allowed.includes('profileId') && !uuid(request.profileId)) ||
      (allowed.includes('bounds') && !validShopBounds(request.bounds)) ||
      (request.action === 'open' && !['merchant', 'feige'].includes(request.target ?? ''))
    ) {
      fail('SHOP_PROFILE_INVALID_REQUEST')
    }

    if (request.action === 'close') {
      await this.closeView()

      return { ok: true, openProfileId: null }
    }

    if (request.action === 'bounds') {
      if (this.opened?.id !== request.profileId) {
        fail('SHOP_PROFILE_NOT_OPEN')
      }

      this.opened.view.setBounds(request.bounds!)

      return { ok: true, openProfileId: request.profileId }
    }

    const scope = await this.authority()
    let profiles = await this.read(scope)

    if (request.action === 'list') {
      profiles = await this.syncCloud(scope, profiles, true)
    }

    if (request.action === 'list') {
      return {
        ok: true,
        profiles: profiles
          .filter(profile => !this.revokedProfiles.has(profile.id) && (!profile.cloudRevision || this.cloudReady))
          .map(publicProfile),
        cloud: this.cloudStatus,
        openProfileId: this.opened?.id ?? null,
        browser: this.opened?.view.workspace?.snapshot()
      }
    }

    if (request.action === 'create') {
      const profile: StoredProfile = {
        id: randomUUID(),
        storageId: randomUUID(),
        storageLayout: 2,
        tenantId: scope.tenantId,
        principalId: scope.principalId,
        displayName: '店铺登录',
        shopId: null,
        shopName: null,
        createdAt: new Date().toISOString(),
        checkedAt: null,
        loginState: 'unverified'
      }

      await fs.mkdir(this.storage(scope, profile), { recursive: true })
      await this.save(scope, [...profiles, profile])

      return { ok: true, profile: publicProfile(profile) }
    }

    const profile = profiles.find(item => item.id === request.profileId)

    if (!profile) {
      fail('SHOP_PROFILE_NOT_FOUND')
    }

    await this.checkProfileAccess(profile!, request.action !== 'browser')

    if (request.action === 'bookmarks') {
      const bookmarks = await this.bookmarks.operate(request.bookmark!, request.expectedRevision)

      return { ok: true, bookmarks, openProfileId: this.opened?.id ?? null }
    }

    if (request.action === 'browser') {
      if (this.opened?.id !== profile.id) {
        fail('SHOP_PROFILE_NOT_OPEN')
      }

      if (!this.opened.view.workspace) {
        fail('SHOP_BROWSER_UNAVAILABLE')
      }

      const browser = await this.opened.view.workspace.operate(request.browser!)

      await this.authority()

      if (!browser.tabs.length) {
        await this.closeView()
      }

      return { ok: true, browser, openProfileId: this.opened?.id ?? null }
    }

    if (request.action === 'open') {
      await this.closeView()
      const view = await this.deps.createView(this.storage(scope, profile), request.target!, request.bounds!)

      try {
        await this.authority()
        await this.checkProfileAccess(profile!, true)
      } catch (error) {
        await view.close()
        throw error
      }

      this.opened = { id: profile.id, view }
    }

    if (request.action === 'identify') {
      if (this.opened?.id !== profile.id) {
        fail('SHOP_PROFILE_NOT_OPEN')
      }

      const identity = await this.opened.view.identify()
      await this.authority()

      if (identity) {
        if (!/^\d{1,32}$/.test(identity.shopId) || !identity.shopName.trim() || identity.shopName.length > 200) {
          fail('SHOP_PROFILE_IDENTITY_INVALID')
        }

        if (profile.shopId && profile.shopId !== identity.shopId) {
          fail('SHOP_PROFILE_IDENTITY_CHANGED')
        }

        profile.shopId = identity.shopId
        profile.shopName = identity.shopName.trim()
        profile.displayName = profile.shopName
        profile.loginState = 'verified'
      } else {
        profile.loginState = 'expired'
      }

      profile.checkedAt = new Date().toISOString()
      await this.save(scope, profiles)

      if (identity) {
        await this.backup(scope, profiles, profile)
      }
    }

    if (request.action === 'relogin' || request.action === 'delete') {
      if ([...this.executions].some(item => item.profileId === profile.id)) {
        fail('SHOP_PROFILE_IN_USE')
      }

      if (request.action === 'delete' && profile.cloudRevision && this.deps.cloud) {
        await this.deps.cloud.hide(profile.id, profile.cloudRevision)
        await this.authority()
      }

      if (this.opened?.id === profile.id) {
        // Closing must not upload the local login after a personal removal/reset.
        profile.loginState = 'unverified'
        await this.save(scope, profiles)
        await this.closeView()
      }

      await this.deps.clearStorage(this.storage(scope, profile))
      await this.authority()

      if (request.action === 'delete') {
        await this.save(
          scope,
          profiles.filter(item => item.id !== profile.id)
        )
      } else {
        profile.storageId = randomUUID()
        profile.storageLayout = 2

        if (!profile.cloudRevision) {
          profile.shopId = null
          profile.shopName = null
          profile.displayName = '店铺登录'
        }

        profile.checkedAt = null
        profile.loginState = 'unverified'
        await fs.mkdir(this.storage(scope, profile), { recursive: true })
        await this.save(scope, profiles)
      }
      // Session directories may remain OS-locked until Chromium exits. Their
      // cookies are cleared first and the metadata never points to them again.
    }

    return {
      ok: true,
      profile: publicProfile(profile),
      cloud: this.cloudStatus,
      openProfileId: this.opened?.id ?? null,
      browser: this.opened?.view.workspace?.snapshot()
    }
  }
}
