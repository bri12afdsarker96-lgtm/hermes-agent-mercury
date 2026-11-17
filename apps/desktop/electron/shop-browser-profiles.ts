import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { ShopBrowserBookmarks } from './shop-browser-bookmarks'
import type { CloudShopRecord, PortableShopSession, ShopProfileCloud } from './shop-browser-cloud'
import { validShopPrincipalIds } from './shop-browser-cloud'
import type { BoundShopExecution, ShopExecutionTransport } from './shop-browser-execution'
import type { ShopBrowserBounds, ShopBrowserProfile, ShopBrowserReply, ShopBrowserRequest } from './shop-browser-types'
import { recoverableShopBrowserErrors } from './shop-browser-types'
import type { ShopBrowserPageControls, ShopBrowserWorkspace } from './shop-browser-workspace-types'
import { validShopPayoutSettings } from './shop-payout-settings'

export interface ShopBrowserAuthority {
  origin: string
  tenantId: string
  principalId: string
  role?: string
}
interface StoredProfile extends ShopBrowserProfile {
  storageId: string
  storageLayout?: 2
  // Metadata can advance while the imported login partition remains mounted.
  cloudMetadataRevision?: number
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
  loginState: profile.loginState,
  ...(profile.completionState ? { completionState: profile.completionState } : {}),
  ...(profile.cloudRevision ? { cloudPayoutSettingsState: profile.cloudPayoutSettingsState ?? 'unknown' } : {}),
  ...(profile.cloudRevision ? {
    cloudRevision: profile.cloudMetadataRevision ?? profile.cloudRevision,
    createdBy: profile.createdBy ?? null,
    createdByName: profile.createdByName ?? null,
    servicingPrincipalId: profile.servicingPrincipalIds?.[0] ?? null,
    servicingPrincipalName: profile.servicingPrincipalNames?.[0] ?? null,
    servicingPrincipalIds: [...(profile.servicingPrincipalIds ?? [])],
    servicingPrincipalNames: [...(profile.servicingPrincipalNames ?? [])]
  } : {}),
  ...(profile.payoutSettings ? {
    payoutSettings: { ...profile.payoutSettings },
    payoutSettingsRevision: profile.payoutSettingsRevision ?? 0
  } : {})
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
  private pendingIdentity?: { profileId: string; shopId: string; shopName: string; token: string; view: ShopBrowserView; scopeKey: string }
  private pendingEpoch = 0
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
        (profile.payoutSettings !== undefined && !validShopPayoutSettings(profile.payoutSettings)) ||
        (profile.completionState !== undefined && !['identity-unknown', 'settings-pending'].includes(profile.completionState)) ||
        (profile.cloudPayoutSettingsState !== undefined && !['saved', 'missing', 'unknown'].includes(profile.cloudPayoutSettingsState)) ||
        (profile.payoutSettingsRevision !== undefined &&
          (!Number.isSafeInteger(profile.payoutSettingsRevision) || profile.payoutSettingsRevision < 0)) ||
        (profile.servicingPrincipalIds !== undefined && !validShopPrincipalIds(profile.servicingPrincipalIds)) ||
        (profile.servicingPrincipalNames !== undefined &&
          (!Array.isArray(profile.servicingPrincipalNames) ||
            profile.servicingPrincipalNames.length !== profile.servicingPrincipalIds?.length ||
            profile.servicingPrincipalNames.some(name => name !== null && typeof name !== 'string'))) ||
        (profile.cloudRevision !== undefined &&
          (!Number.isSafeInteger(profile.cloudRevision) || profile.cloudRevision < 1)) ||
        (profile.cloudMetadataRevision !== undefined &&
          (!Number.isSafeInteger(profile.cloudMetadataRevision) || profile.cloudMetadataRevision < 1))
      ) {
        fail('SHOP_PROFILE_STORE_INVALID')
      }

      // Older interrupted attempts may have persisted a verified flag while
      // completion was still pending; never expose that flag as executable.
      if (profile.completionState && profile.loginState === 'verified') {
        profile.loginState = 'unverified'
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
    this.pendingIdentity = undefined

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

  private async assertCloudProfileAccess(profile: StoredProfile) {
    try {
      await this.authority()
      await this.checkProfileAccess(profile, true)
    } catch (error) {
      this.cloudAccess = undefined
      const closing: Promise<void>[] = []

      if (this.opened?.id === profile.id) {
        closing.push(this.closeView(false))
      }

      closing.push(...[...this.executions]
        .filter(execution => execution.profileId === profile.id)
        .map(execution => execution.close()))
      await Promise.allSettled(closing)
      throw error
    }
  }

  private applyCloudPayoutSettings(profile: StoredProfile, remote: CloudShopRecord) {
    const state = remote.payout_settings === undefined ? 'unknown' : remote.payout_settings === null ? 'missing' : 'saved'
    const stateChanged = profile.cloudPayoutSettingsState !== state
    profile.cloudPayoutSettingsState = state
    if (!remote.payout_settings) {
      return stateChanged
    }

    const changed = profile.payoutSettingsRevision !== remote.payout_settings_revision ||
      Object.entries(remote.payout_settings).some(
        ([key, value]) => profile.payoutSettings?.[key as keyof typeof remote.payout_settings] !== value
      )
    if (!changed) {
      return stateChanged
    }
    profile.payoutSettings = { ...remote.payout_settings }
    profile.payoutSettingsRevision = remote.payout_settings_revision!

    return changed || stateChanged
  }

  private applyCloudAssignment(profile: StoredProfile, remote: CloudShopRecord) {
    const ids = remote.servicing_principal_ids ??
      (remote.servicing_principal_id == null ? [] : [remote.servicing_principal_id])

    const names = remote.servicing_principal_names ?? ids.map(() => remote.servicing_principal_name ?? null)

    const metadata = {
      cloudMetadataRevision: remote.revision,
      createdBy: remote.created_by ?? null,
      createdByName: remote.created_by_name ?? null,
      servicingPrincipalIds: [...ids],
      servicingPrincipalNames: [...names]
    }

    const changed = Object.entries(metadata).some(([key, value]) =>
      JSON.stringify(profile[key as keyof StoredProfile]) !== JSON.stringify(value))

    Object.assign(profile, metadata)

    return changed
  }

  private async migratePayoutSettings(profile: StoredProfile, remote: CloudShopRecord) {
    if (remote.payout_settings !== null || !profile.payoutSettings || profile.completionState ||
        this.pendingIdentity?.profileId === profile.id) {
      return remote
    }

    const saved = await this.deps.cloud!.savePayoutSettings(profile.id, remote.revision, 0, profile.payoutSettings)
    await this.authority()
    await this.checkProfileAccess(profile, true)
    const readback = await this.deps.cloud!.get(profile.id)
    await this.authority()
    await this.checkProfileAccess(profile, true)
    if (readback.revision !== saved.revision || readback.payout_settings_revision !== saved.payout_settings_revision ||
        !readback.payout_settings || Object.entries(profile.payoutSettings).some(([key, value]) =>
          readback.payout_settings![key as keyof typeof profile.payoutSettings] !== value)) {
      fail('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
    }
    this.applyCloudPayoutSettings(profile, readback)

    if (profile.cloudRevision === remote.revision) {
      profile.cloudRevision = saved.revision
    }

    this.cloudAccess = undefined

    return readback
  }

  private async backup(scope: ShopBrowserAuthority, profiles: StoredProfile[], profile: StoredProfile) {
    if (!this.deps.cloud || !this.deps.exportSession || !profile.shopId || !profile.shopName ||
        profile.completionState || this.pendingIdentity?.profileId === profile.id) {
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

      let saved = await this.deps.cloud.save(publicProfile(profile), profile.cloudRevision ?? 0, session)
      await this.authority()
      profile.cloudRevision = saved.revision
      saved = await this.migratePayoutSettings(profile, saved)
      this.applyCloudAssignment(profile, saved)
      this.applyCloudPayoutSettings(profile, saved)
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

      for (let remote of records) {
        if (!remote.deleted) {
          this.revokedProfiles.delete(remote.profile_id)
        }

        const local = profiles.find(profile => profile.id === remote.profile_id)

        if (local && !remote.deleted) {
          const previousRevision = remote.revision
          const changed = this.applyCloudPayoutSettings(local, remote)

          if (![...this.executions].some(item => item.profileId === local.id)) {
            remote = await this.migratePayoutSettings(local, remote)
          }

          const assignmentChanged = this.applyCloudAssignment(local, remote)

          if (changed || assignmentChanged || remote.revision !== previousRevision) {
            await this.save(scope, profiles)
          }
        }

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

        if (local?.completionState) { restored.completionState = local.completionState }

        this.applyCloudAssignment(restored, detail)

        // Cloud settings follow the enterprise asset. Legacy local settings are
        // retained only while the cloud has no configuration to restore.
        this.applyCloudPayoutSettings(restored, detail)
        if (!detail.payout_settings && local?.payoutSettings) {
          restored.payoutSettings = local.payoutSettings
          restored.payoutSettingsRevision = local.payoutSettingsRevision ?? 0
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
            restored.loginState = identity?.shopId === restored.shopId && identity.shopName === restored.shopName
              ? (restored.completionState ? 'unverified' : 'verified') : 'expired'
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
    this.pendingEpoch++
    this.pendingIdentity = undefined
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
      let closing: Promise<void> | undefined

      const execution: BoundShopExecution = {
        connectionId: randomUUID().replaceAll('-', ''),
        profileId,
        shopId: profile.shopId,
        shopName: profile.shopName,
        identify: async () => {
          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

          await this.assertCloudProfileAccess(profile!)

          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

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

          await this.assertCloudProfileAccess(profile!)

          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

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

          await this.assertCloudProfileAccess(profile!)

          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

          const identity = await transport.identify()
          await this.authority()

          if (released) {
            fail('SHOP_PROFILE_OWNER_CHANGED')
          }

          if (!identity || identity.shopId !== profile.shopId || identity.shopName !== profile.shopName) {
            fail('SHOP_PROFILE_IDENTITY_CHANGED')
          }
        },
        close: () => {
          closing ??= (async () => {
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
          })()

          return closing
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
    if (['cancelIdentity', 'close', 'open', 'relogin', 'delete'].includes(request.action)) {
      this.pendingEpoch++
    }
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
      confirmIdentity: ['profileId', 'pendingToken', 'payoutSettings'],
      cancelIdentity: ['profileId', 'pendingToken'],
      close: [],
      relogin: ['profileId'],
      delete: ['profileId'],
      bounds: ['profileId', 'bounds'],
      browser: ['profileId', 'browser'],
      bookmarks: ['profileId', 'bookmark', 'expectedRevision'],
      savePayoutSettings: ['profileId', 'payoutSettings', 'expectedRevision'],
      assign: ['profileId', 'principalIds', 'expectedRevision']
    }

    const allowed =
      typeof request?.action === 'string' && Object.hasOwn(fields, request.action) ? fields[request.action] : undefined

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

    if (request.action === 'assign' && scope.role !== 'tenant_admin') {
      fail('SHOP_PROFILE_FORBIDDEN')
    }

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

    if (request.action === 'browser' && request.browser?.action === 'state') {
      await this.checkProfileAccess(profile!)
    } else {
      await this.assertCloudProfileAccess(profile!)
    }

    if (request.action === 'assign') {
      if (
        !validShopPrincipalIds(request.principalIds) ||
        !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision! < 1 ||
        !profile.cloudRevision ||
        !this.deps.cloud
      ) {
        fail('SHOP_PROFILE_INVALID_REQUEST')
      }

      const saved = await this.deps.cloud.assign(profile.id, request.expectedRevision!, request.principalIds!)
      await this.authority()
      this.applyCloudAssignment(profile, saved)
      this.applyCloudPayoutSettings(profile, saved)
      this.cloudAccess = undefined
      this.nextCloudCheck = 0
      await this.save(scope, profiles)
      profiles = await this.syncCloud(scope, profiles, true)

      return {
        ok: true,
        profile: publicProfile(profiles.find(item => item.id === profile.id) ?? profile),
        profiles: profiles
          .filter(item => !this.revokedProfiles.has(item.id) && (!item.cloudRevision || this.cloudReady))
          .map(publicProfile),
        cloud: this.cloudStatus
      }
    }

    if (request.action === 'savePayoutSettings') {
      if (!validShopPayoutSettings(request.payoutSettings)) {
        fail('SHOP_PAYOUT_SETTINGS_INVALID')
      }

      if (request.expectedRevision !== (profile.payoutSettingsRevision ?? 0)) {
        fail('SHOP_PAYOUT_SETTINGS_CONFLICT')
      }

      const settings = { ...request.payoutSettings, remitAmount: request.payoutSettings.remitAmount.trim() }

      if (profile.cloudRevision && this.deps.cloud) {
        try {
          const remote = await this.deps.cloud.get(profile.id)
          await this.authority()

          if (remote.deleted || remote.payout_settings === undefined) {
            fail('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
          }

          if (remote.payout_settings && remote.payout_settings_revision !== request.expectedRevision) {
            fail('SHOP_PAYOUT_SETTINGS_CONFLICT')
          }

          const saved = await this.deps.cloud.savePayoutSettings(
            profile.id,
            remote.revision,
            remote.payout_settings_revision!,
            settings
          )
          await this.authority()
          await this.checkProfileAccess(profile, true)
          this.applyCloudPayoutSettings(profile, saved)

          this.applyCloudAssignment(profile, saved)

          if (profile.cloudRevision === remote.revision) {
            profile.cloudRevision = saved.revision
          }

          this.cloudAccess = undefined
          this.nextCloudCheck = 0
          this.cloudStatus = { state: 'synced', checkedAt: new Date().toISOString() }
        } catch (error) {
          this.assertCurrent()
          const code = error instanceof Error ? error.message : ''
          this.cloudAccess = undefined
          this.nextCloudCheck = 0
          const conflict = /CONFLICT|409|revision_conflict/.test(code)
          this.cloudStatus = { state: conflict ? 'conflict' : 'unavailable', checkedAt: new Date().toISOString() }

          if (/OWNER_CHANGED|SHOP_PROFILE_FORBIDDEN/.test(code)) {
            throw error
          }

          fail(conflict ? 'SHOP_PAYOUT_SETTINGS_CONFLICT' : 'SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
        }
      } else {
        profile.payoutSettings = settings
        profile.payoutSettingsRevision = (profile.payoutSettingsRevision ?? 0) + 1
      }

      await this.authority()
      await this.checkProfileAccess(profile, true)
      await this.save(scope, profiles)

      return { ok: true, profile: publicProfile(profile) }
    }

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

    if (request.action === 'cancelIdentity') {
      if (this.pendingIdentity?.profileId === profile.id && this.pendingIdentity.token === request.pendingToken) {
        this.pendingIdentity = undefined
      }
      return { ok: true, profile: publicProfile(profile), openProfileId: this.opened?.id ?? null }
    }

    if (request.action === 'confirmIdentity') {
      const pending = this.pendingIdentity
      const epoch = this.pendingEpoch
      if (!pending || pending.profileId !== profile.id || pending.token !== request.pendingToken ||
          pending.scopeKey !== scopeKey(scope) || this.opened?.view !== pending.view) {
        fail('SHOP_PROFILE_IDENTITY_CHANGED')
      }
      if (!validShopPayoutSettings(request.payoutSettings)) {
        fail('SHOP_PAYOUT_SETTINGS_INVALID')
      }
      const current = await pending.view.identify()
      await this.authority()
      await this.checkProfileAccess(profile, true)
      if (this.pendingIdentity !== pending || this.pendingEpoch !== epoch || this.opened?.view !== pending.view ||
          !current || current.shopId !== pending.shopId || current.shopName.trim() !== pending.shopName) {
        fail('SHOP_PROFILE_IDENTITY_CHANGED')
      }
      if (this.deps.cloud) {
        if (!this.deps.exportSession) { fail('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE') }
        const settings = { ...request.payoutSettings, remitAmount: request.payoutSettings.remitAmount.trim() }
        const initial = !profile.shopId && !profile.cloudRevision && !profile.completionState
        try {
          let remote: CloudShopRecord
          if (initial) {
            const session = await this.deps.exportSession(this.storage(scope, profile))
            await this.authority()
            if (this.pendingEpoch !== epoch || this.opened?.view !== pending.view) { fail('SHOP_PROFILE_IDENTITY_CHANGED') }
            // From this durable boundary onward the write may have been sent.
            // A crash before the call remains conservatively unknown.
            profile.shopId = pending.shopId
            profile.shopName = pending.shopName
            profile.displayName = pending.shopName
            profile.checkedAt = new Date().toISOString()
            profile.loginState = 'unverified'
            profile.completionState = 'identity-unknown'
            await this.save(scope, profiles)
            await this.authority()
            if (this.pendingEpoch !== epoch || this.opened?.view !== pending.view) { fail('SHOP_PROFILE_IDENTITY_CHANGED') }
            remote = await this.deps.cloud.save(publicProfile(profile), 0, session)
          } else {
            // On an uncertain result, read first: never blindly repeat identity POST.
            remote = await this.deps.cloud.get(profile.id)
          }
          await this.authority()
          if (this.pendingEpoch !== epoch || this.opened?.view !== pending.view) { fail('SHOP_PROFILE_IDENTITY_CHANGED') }
          if (remote.deleted || remote.profile?.shop_id !== pending.shopId ||
              remote.payout_settings === undefined || remote.payout_settings_revision === undefined) {
            fail('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
          }
          profile.cloudRevision = remote.revision
          profile.completionState = 'settings-pending'
          await this.save(scope, profiles)
          await this.checkProfileAccess(profile, true)
          if (this.pendingEpoch !== epoch || this.opened?.view !== pending.view) { fail('SHOP_PROFILE_IDENTITY_CHANGED') }
          if (remote.payout_settings === null && remote.payout_settings_revision === 0) {
            await this.deps.cloud.savePayoutSettings(profile.id, remote.revision, 0, settings)
          } else if (!remote.payout_settings || Object.entries(settings).some(([key, value]) =>
            remote.payout_settings![key as keyof typeof settings] !== value)) {
            fail('SHOP_PAYOUT_SETTINGS_CONFLICT')
          }
          remote = await this.deps.cloud.get(profile.id)
          await this.authority()
          await this.checkProfileAccess(profile, true)
          if (this.pendingEpoch !== epoch || this.opened?.view !== pending.view) { fail('SHOP_PROFILE_IDENTITY_CHANGED') }
          if (!remote.payout_settings || remote.payout_settings_revision! < 1 ||
              Object.entries(settings).some(([key, value]) => remote.payout_settings![key as keyof typeof settings] !== value)) {
            fail('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
          }
          this.applyCloudPayoutSettings(profile, remote)
          this.applyCloudAssignment(profile, remote)
          profile.cloudRevision = remote.revision
        } catch (error) {
          const code = error instanceof Error ? error.message : ''
          if (/OWNER_CHANGED|FORBIDDEN|CONFLICT|IDENTITY_CHANGED/.test(code)) { throw error }
          fail('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
        }
      }
      profile.shopId = pending.shopId
      profile.shopName = pending.shopName
      profile.displayName = pending.shopName
      profile.loginState = 'verified'
      profile.checkedAt = new Date().toISOString()
      profile.payoutSettings = { ...request.payoutSettings, remitAmount: request.payoutSettings.remitAmount.trim() }
      if (!this.deps.cloud) { profile.payoutSettingsRevision = (profile.payoutSettingsRevision ?? 0) + 1 }
      delete profile.completionState
      await this.save(scope, profiles)
      this.pendingIdentity = undefined
      return { ok: true, profile: publicProfile(profile), openProfileId: profile.id }
    }

    if (request.action === 'identify') {
      if (this.opened?.id !== profile.id) {
        fail('SHOP_PROFILE_NOT_OPEN')
      }

      const view = this.opened.view
      const epoch = this.pendingEpoch
      const identity = await view.identify()
      await this.authority()
      if (this.pendingEpoch !== epoch || this.opened?.view !== view) { fail('SHOP_PROFILE_IDENTITY_CHANGED') }

      if (identity) {
        if (!/^\d{1,32}$/.test(identity.shopId) || !identity.shopName.trim() || identity.shopName.length > 200) {
          fail('SHOP_PROFILE_IDENTITY_INVALID')
        }

        if (profile.shopId && profile.shopId !== identity.shopId) {
          fail('SHOP_PROFILE_IDENTITY_CHANGED')
        }

        let settingsSaved = Boolean(profile.shopId && profile.payoutSettings && !profile.completionState)
        if (profile.cloudRevision) {
          if (!this.deps.cloud) {
            fail('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
          }
          const remote = await this.deps.cloud.get(profile.id)
          await this.authority()
          await this.checkProfileAccess(profile, true)
          if (this.pendingEpoch !== epoch || this.opened?.view !== view) { fail('SHOP_PROFILE_IDENTITY_CHANGED') }
          if (remote.deleted || remote.payout_settings === undefined || remote.payout_settings_revision === undefined) {
            fail('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
          }
          const cloudSettingsSaved = Boolean(remote.payout_settings && remote.payout_settings_revision > 0)
          settingsSaved = cloudSettingsSaved && !profile.completionState
          if (cloudSettingsSaved) {
            this.applyCloudPayoutSettings(profile, remote)
          } else {
            profile.completionState = 'settings-pending'
            profile.cloudPayoutSettingsState = 'missing'
            await this.save(scope, profiles)
          }
        }

        if (!settingsSaved) {
          const pending = { profileId: profile.id, shopId: identity.shopId, shopName: identity.shopName.trim(),
            token: randomUUID(), view, scopeKey: scopeKey(scope) }
          this.pendingIdentity = pending
          return { ok: true, pendingIdentity: { profileId: pending.profileId, shopId: pending.shopId,
            shopName: pending.shopName, token: pending.token }, openProfileId: profile.id }
        }

        profile.shopId = identity.shopId
        profile.shopName = identity.shopName.trim()
        profile.displayName = profile.shopName
        profile.loginState = 'verified'
        delete profile.completionState
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
        await this.deps.cloud.hide(profile.id, profile.cloudMetadataRevision ?? profile.cloudRevision)
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
