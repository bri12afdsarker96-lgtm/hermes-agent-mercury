import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { ShopBrowserBounds, ShopBrowserProfile, ShopBrowserReply, ShopBrowserRequest } from './shop-browser-types'
import type { BoundShopExecution, ShopExecutionTransport } from './shop-browser-execution'

export interface ShopBrowserAuthority {
  origin: string
  tenantId: string
  principalId: string
}
interface StoredProfile extends ShopBrowserProfile {
  storageId: string
  storageLayout?: 2
}
export interface ShopBrowserView {
  identify(): Promise<{ shopId: string; shopName: string } | null>
  setBounds(bounds: ShopBrowserBounds): void
  close(): Promise<void>
}
export interface ShopBrowserDependencies {
  root: string
  authorize(): Promise<ShopBrowserAuthority>
  isCurrent(): boolean
  createView(storagePath: string, target: 'merchant' | 'feige', bounds: ShopBrowserBounds): Promise<ShopBrowserView>
  clearStorage(storagePath: string): Promise<void>
  createExecution?(storagePath: string, target: 'merchant' | 'feige'): Promise<ShopExecutionTransport>
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

  constructor(private deps: ShopBrowserDependencies) {}

  private assertCurrent() {
    if (this.invalidated || !this.deps.isCurrent()) fail('SHOP_PROFILE_OWNER_CHANGED')
  }

  private async authority() {
    this.assertCurrent()
    const current = await this.deps.authorize()
    this.assertCurrent()
    if (!current.origin || !current.tenantId || !current.principalId) fail('SHOP_PROFILE_FORBIDDEN')
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const data = JSON.parse(raw)
    if (data.version !== 1 || !Array.isArray(data.profiles)) fail('SHOP_PROFILE_STORE_INVALID')
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
        (profile.storageLayout !== undefined && profile.storageLayout !== 2)
      )
        fail('SHOP_PROFILE_STORE_INVALID')
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

  private async closeView() {
    const opened = this.opened
    this.opened = undefined
    if (opened) await opened.view.close()
  }

  invalidate() {
    this.invalidated = true
    // Detaching is immediate even when an identify request is still in flight.
    void this.closeView().catch(() => {})
    for (const execution of this.executions) void execution.close().catch(() => {})
  }

  async revalidate() {
    if (!this.opened && this.executions.size === 0) return
    try {
      await this.authority()
    } catch {
      await this.closeView()
      await Promise.all([...this.executions].map(execution => execution.close()))
    }
  }

  acquireExecution(profileId: string, target: 'merchant' | 'feige'): Promise<BoundShopExecution> {
    const operation = this.tail.then(async () => {
      if (!uuid(profileId) || !this.deps.createExecution) fail('SHOP_PROFILE_INVALID_REQUEST')
      const scope = await this.authority()
      const profile = (await this.read(scope)).find(item => item.id === profileId)
      if (!profile || profile.loginState !== 'verified' || !profile.shopId || !profile.shopName)
        fail('SHOP_PROFILE_UNVERIFIED')
      if ([...this.executions].some(item => item.profileId === profileId)) fail('SHOP_PROFILE_IN_USE')
      const transport = await this.deps.createExecution(this.storage(scope, profile), target)
      let released = false
      const execution: BoundShopExecution = {
        connectionId: randomUUID().replaceAll('-', ''), profileId,
        shopId: profile.shopId, shopName: profile.shopName,
        identify: () => transport.identify(),
        async command(targetId, method, params) {
          if (released) fail('SHOP_PROFILE_OWNER_CHANGED')
          return transport.command(targetId, method, params)
        },
        validate: async () => {
          if (released) fail('SHOP_PROFILE_OWNER_CHANGED')
          await this.authority()
          const identity = await transport.identify()
          await this.authority()
          if (!identity || identity.shopId !== profile.shopId || identity.shopName !== profile.shopName)
            fail('SHOP_PROFILE_IDENTITY_CHANGED')
        },
        close: async () => {
          if (released) return
          released = true
          this.executions.delete(execution)
          await transport.close()
        }
      }
      this.executions.add(execution)
      try { await execution.validate(); return execution }
      catch (error) { await execution.close(); throw error }
    })
    this.tail = operation.catch(() => {})
    return operation
  }

  operate(request: ShopBrowserRequest): Promise<ShopBrowserReply> {
    const operation = this.tail
      .then(() => this.perform(request))
      .catch(async error => {
        const code = error instanceof Error ? error.message : 'SHOP_PROFILE_FAILED'
        if (!['SHOP_PROFILE_INVALID_REQUEST', 'SHOP_PROFILE_NOT_FOUND', 'SHOP_PROFILE_NOT_OPEN', 'SHOP_PROFILE_IN_USE'].includes(code))
          await this.closeView().catch(() => {})
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
      bounds: ['profileId', 'bounds']
    }
    const allowed = fields[request?.action]
    if (
      !allowed ||
      Object.keys(request).some(key => !['sessionId', 'action', ...allowed].includes(key)) ||
      (allowed.includes('profileId') && !uuid(request.profileId)) ||
      (allowed.includes('bounds') && !validShopBounds(request.bounds)) ||
      (request.action === 'open' && !['merchant', 'feige'].includes(request.target ?? ''))
    )
      fail('SHOP_PROFILE_INVALID_REQUEST')
    if (request.action === 'close') {
      await this.closeView()
      return { ok: true, openProfileId: null }
    }
    if (request.action === 'bounds') {
      if (this.opened?.id !== request.profileId) fail('SHOP_PROFILE_NOT_OPEN')
      this.opened.view.setBounds(request.bounds!)
      return { ok: true, openProfileId: request.profileId }
    }
    const scope = await this.authority()
    const profiles = await this.read(scope)
    if (request.action === 'list')
      return { ok: true, profiles: profiles.map(publicProfile), openProfileId: this.opened?.id ?? null }
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
    if (!profile) fail('SHOP_PROFILE_NOT_FOUND')
    if (request.action === 'open') {
      await this.closeView()
      const view = await this.deps.createView(this.storage(scope, profile), request.target!, request.bounds!)
      try {
        await this.authority()
      } catch (error) {
        await view.close()
        throw error
      }
      this.opened = { id: profile.id, view }
    }
    if (request.action === 'identify') {
      if (this.opened?.id !== profile.id) fail('SHOP_PROFILE_NOT_OPEN')
      const identity = await this.opened.view.identify()
      await this.authority()
      if (identity) {
        if (!/^\d{1,32}$/.test(identity.shopId) || !identity.shopName.trim() || identity.shopName.length > 200)
          fail('SHOP_PROFILE_IDENTITY_INVALID')
        if (profile.shopId && profile.shopId !== identity.shopId) fail('SHOP_PROFILE_IDENTITY_CHANGED')
        profile.shopId = identity.shopId
        profile.shopName = identity.shopName.trim()
        profile.displayName = profile.shopName
        profile.loginState = 'verified'
      } else {
        profile.loginState = 'expired'
      }
      profile.checkedAt = new Date().toISOString()
      await this.save(scope, profiles)
    }
    if (request.action === 'relogin' || request.action === 'delete') {
      if ([...this.executions].some(item => item.profileId === profile.id)) fail('SHOP_PROFILE_IN_USE')
      if (this.opened?.id === profile.id) {
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
        profile.shopId = null
        profile.shopName = null
        profile.checkedAt = null
        profile.displayName = '店铺登录'
        profile.loginState = 'unverified'
        await fs.mkdir(this.storage(scope, profile), { recursive: true })
        await this.save(scope, profiles)
      }
      // Session directories may remain OS-locked until Chromium exits. Their
      // cookies are cleared first and the metadata never points to them again.
    }
    return { ok: true, profile: publicProfile(profile), openProfileId: this.opened?.id ?? null }
  }
}
