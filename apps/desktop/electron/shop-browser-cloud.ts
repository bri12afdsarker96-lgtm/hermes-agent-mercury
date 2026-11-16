import type { ShopBrowserProfile } from './shop-browser-types'
import { type ShopPayoutSettings, validShopPayoutSettings } from './shop-payout-settings'

export interface PortableShopCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  expirationDate?: number
}
export interface PortableShopSession {
  version: 1
  cookies: PortableShopCookie[]
  origins: { origin: string; localStorage: [string, string][] }[]
}
export interface CloudShopMetadata {
  display_name: string
  shop_id: string
  shop_name: string
  created_at: string
  checked_at: string | null
}
export interface CloudShopRecord {
  profile_id: string
  revision: number
  deleted: boolean
  updated_at: string
  created_by?: string | null
  created_by_name?: string | null
  servicing_principal_id?: string | null
  servicing_principal_name?: string | null
  servicing_principal_ids?: string[]
  servicing_principal_names?: (string | null)[]
  profile?: CloudShopMetadata
  session?: PortableShopSession
  payout_settings?: ShopPayoutSettings | null
  payout_settings_revision?: number
}
export interface ShopProfileCloud {
  list(): Promise<{ profiles: CloudShopRecord[]; hiddenProfileIds: string[] }>
  get(profileId: string): Promise<CloudShopRecord>
  save(profile: ShopBrowserProfile, revision: number, session: PortableShopSession): Promise<CloudShopRecord>
  savePayoutSettings(
    profileId: string,
    revision: number,
    settingsRevision: number,
    settings: ShopPayoutSettings
  ): Promise<CloudShopRecord>
  hide(profileId: string, revision: number): Promise<void>
  assign(profileId: string, revision: number, principalIds: string[]): Promise<CloudShopRecord>
}
export interface ShopProfileCloudTransport {
  request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>
  assertCurrent(): void
}

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/

export function validShopPrincipalIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200 && id.trim() === id) &&
    new Set(value).size === value.length
  )
}

export function isShopProfileCredentialRequest(method: string, pathname: string): boolean {
  return (
    pathname === '/api/shop-login-profile' ||
    (method.toUpperCase() !== 'GET' && pathname === '/api/shop-login-profiles')
  )
}

export function isPortableShopDomain(domain: unknown): domain is string {
  if (typeof domain !== 'string') {
    return false
  }

  const host = domain.replace(/^\./, '')

  return ['jinritemai.com', 'douyin.com'].some(root => host === root || host.endsWith('.' + root))
}

export function validatePortableShopSession(value: unknown): PortableShopSession {
  const data = value as PortableShopSession

  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.cookies) ||
    !Array.isArray(data.origins) ||
    data.cookies.length > 5000 ||
    data.origins.length > 100 ||
    JSON.stringify(data).length > 8 * 1024 * 1024
  ) {
    throw new Error('SHOP_CLOUD_SESSION_INVALID')
  }

  for (const cookie of data.cookies) {
    if (
      !cookie ||
      !isPortableShopDomain(cookie.domain) ||
      typeof cookie.name !== 'string' ||
      typeof cookie.value !== 'string' ||
      typeof cookie.path !== 'string' ||
      !cookie.path.startsWith('/') ||
      typeof cookie.secure !== 'boolean' ||
      typeof cookie.httpOnly !== 'boolean' ||
      typeof cookie.hostOnly !== 'boolean' ||
      !['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite) ||
      (cookie.expirationDate !== undefined && !Number.isFinite(cookie.expirationDate))
    ) {
      throw new Error('SHOP_CLOUD_SESSION_INVALID')
    }
  }

  const seen = new Set<string>()

  for (const entry of data.origins) {
    let url: URL

    try {
      url = new URL(entry.origin)
    } catch {
      throw new Error('SHOP_CLOUD_SESSION_INVALID')
    }

    if (
      url.protocol !== 'https:' ||
      url.origin !== entry.origin ||
      url.port ||
      url.username ||
      url.password ||
      !isPortableShopDomain(url.hostname) ||
      seen.has(entry.origin) ||
      !Array.isArray(entry.localStorage) ||
      entry.localStorage.some(
        pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(item => typeof item !== 'string')
      )
    ) {
      throw new Error('SHOP_CLOUD_SESSION_INVALID')
    }

    seen.add(entry.origin)
  }

  return data
}

function record(value: unknown, withSession = false): CloudShopRecord {
  const data = value as CloudShopRecord

  if (
    !data ||
    !uuid.test(data.profile_id) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 1 ||
    typeof data.deleted !== 'boolean' ||
    !Number.isFinite(Date.parse(data.updated_at))
  ) {
    throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
  }

  if (!data.deleted) {
    const profile = data.profile

    if (
      !profile ||
      typeof profile.display_name !== 'string' ||
      !profile.display_name.trim() ||
      profile.display_name.length > 200 ||
      !/^\d{1,32}$/.test(profile.shop_id) ||
      typeof profile.shop_name !== 'string' ||
      !profile.shop_name.trim() ||
      profile.shop_name.length > 200 ||
      !Number.isFinite(Date.parse(profile.created_at)) ||
      (profile.checked_at !== null && !Number.isFinite(Date.parse(profile.checked_at)))
    ) {
      throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
    }

    if (withSession) {
      validatePortableShopSession(data.session)
    }

    if ('payout_settings' in data || 'payout_settings_revision' in data) {
      if (
        !Number.isSafeInteger(data.payout_settings_revision) ||
        (data.payout_settings === null
          ? data.payout_settings_revision !== 0
          : !validShopPayoutSettings(data.payout_settings) || data.payout_settings_revision! < 1)
      ) {
        throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
      }
    }
  }

  const hasAssignment = 'servicing_principal_ids' in data || 'servicing_principal_names' in data

  const ids = hasAssignment
    ? data.servicing_principal_ids
    : data.servicing_principal_id == null ? [] : [data.servicing_principal_id]

  const names = hasAssignment
    ? data.servicing_principal_names
    : ids?.length ? [data.servicing_principal_name ?? null] : []

  if (
    !validShopPrincipalIds(ids) ||
    !Array.isArray(names) ||
    names.length !== ids.length ||
    names.some(name => name !== null && typeof name !== 'string')
  ) {
    throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
  }

  return {
    ...data,
    servicing_principal_ids: [...ids],
    servicing_principal_names: [...names],
    servicing_principal_id: ids[0] ?? null,
    servicing_principal_name: names[0] ?? null
  }
}

/** Enterprise bearer and portable credentials stay in the main process. */
export function createShopProfileCloud(transport: ShopProfileCloudTransport): ShopProfileCloud {
  const request = async <T>(method: 'GET' | 'POST', path: string, body?: unknown) => {
    transport.assertCurrent()
    const result = await transport.request<T>(method, path, body)
    transport.assertCurrent()

    return result
  }

  return {
    async list() {
      const result = await request<{ profiles: unknown[]; hidden_profile_ids: unknown[] }>(
        'GET',
        '/api/shop-login-profiles'
      )

      if (
        !Array.isArray(result?.profiles) ||
        !Array.isArray(result.hidden_profile_ids) ||
        result.hidden_profile_ids.some(id => typeof id !== 'string' || !uuid.test(id))
      ) {
        throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
      }

      return {
        profiles: result.profiles.map(item => record(item)),
        hiddenProfileIds: result.hidden_profile_ids as string[]
      }
    },
    async get(profileId) {
      if (!uuid.test(profileId)) {
        throw new Error('SHOP_CLOUD_REQUEST_INVALID')
      }

      const result = await request<{ profile: unknown }>('GET', '/api/shop-login-profile?profile_id=' + profileId)
      const value = record(result?.profile, true)

      if (value.profile_id !== profileId) {
        throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
      }

      return value
    },
    async assign(profileId, revision, principalIds) {
      if (
        !uuid.test(profileId) ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        revision >= Number.MAX_SAFE_INTEGER ||
        !validShopPrincipalIds(principalIds)
      ) {
        throw new Error('SHOP_CLOUD_REQUEST_INVALID')
      }

      const requested = [...principalIds]

      const result = await request<{ profile: unknown }>('POST', '/api/shop-login-profiles-assign', {
        profile_id: profileId,
        principal_ids: requested,
        expected_revision: revision
      })

      const value = record(result?.profile)

      if (
        value.profile_id !== profileId ||
        value.deleted ||
        value.revision !== revision + 1 ||
        value.servicing_principal_ids!.length !== requested.length ||
        value.servicing_principal_ids!.some(id => !requested.includes(id))
      ) {
        throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
      }

      return value
    },
    async savePayoutSettings(profileId, revision, settingsRevision, settings) {
      if (
        !uuid.test(profileId) ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        revision >= Number.MAX_SAFE_INTEGER ||
        !Number.isSafeInteger(settingsRevision) ||
        settingsRevision < 0 ||
        settingsRevision >= Number.MAX_SAFE_INTEGER ||
        !validShopPayoutSettings(settings)
      ) {
        throw new Error('SHOP_CLOUD_REQUEST_INVALID')
      }

      const normalized = { ...settings, remitAmount: settings.remitAmount.trim() }
      const result = await request<{ profile: unknown }>('POST', '/api/shop-login-profiles', {
        profile_id: profileId,
        expected_revision: revision,
        expected_payout_settings_revision: settingsRevision,
        payout_settings: normalized
      })
      const value = record(result?.profile)

      if (
        value.profile_id !== profileId ||
        value.deleted ||
        value.revision !== revision + 1 ||
        value.payout_settings_revision !== settingsRevision + 1 ||
        !value.payout_settings ||
        Object.entries(normalized).some(([key, item]) => value.payout_settings![key as keyof ShopPayoutSettings] !== item)
      ) {
        throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
      }

      return value
    },
    async save(profile, revision, session) {
      validatePortableShopSession(session)

      if (
        !uuid.test(profile.id) ||
        !profile.shopId ||
        !profile.shopName ||
        !Number.isSafeInteger(revision) ||
        revision < 0
      ) {
        throw new Error('SHOP_CLOUD_REQUEST_INVALID')
      }

      const result = await request<{ profile: unknown }>('POST', '/api/shop-login-profiles', {
        profile_id: profile.id,
        expected_revision: revision,
        profile: {
          display_name: profile.displayName,
          shop_id: profile.shopId,
          shop_name: profile.shopName,
          created_at: profile.createdAt,
          checked_at: profile.checkedAt
        },
        session
      })

      const value = record(result?.profile)

      if (value.profile_id !== profile.id || value.deleted || value.revision !== revision + 1) {
        throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
      }

      return value
    },
    async hide(profileId, revision) {
      if (!uuid.test(profileId) || !Number.isSafeInteger(revision) || revision < 1) {
        throw new Error('SHOP_CLOUD_REQUEST_INVALID')
      }

      const result = await request<{ profile_id: string; hidden: boolean }>('POST', '/api/shop-login-profiles-delete', {
        profile_id: profileId,
        expected_revision: revision
      })

      if (result?.profile_id !== profileId || result.hidden !== true) {
        throw new Error('SHOP_CLOUD_RESPONSE_INVALID')
      }
    }
  }
}
