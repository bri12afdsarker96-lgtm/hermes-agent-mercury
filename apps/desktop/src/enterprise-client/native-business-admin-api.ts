import type { EnterpriseClientRuntime } from './runtime'

export interface ShopMailbox {
  providerKey: 'qq' | '126'
  user: string
  hasPassword: boolean
  revision: number
}

export interface ShopSubAccount {
  id: string
  profileId: string
  subAccount: string
  enabled: boolean
  hasPassword: boolean
  createdAt: string
  updatedAt: string
  revision: number
}

export interface ShopSubAccountDraft {
  id?: string
  profileId: string
  subAccount: string
  password?: string
  enabled: boolean
  expectedRevision: number
}

export const nativeSubAccountEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

export function validShopMailbox(value: unknown): value is ShopMailbox {
  const row = value as ShopMailbox | undefined

  return (
    !!row &&
    (row.providerKey === 'qq' || row.providerKey === '126') &&
    typeof row.user === 'string' &&
    typeof row.hasPassword === 'boolean' &&
    validRevision(row.revision)
  )
}

export function validShopSubAccount(value: unknown, profileId: string): value is ShopSubAccount {
  const row = value as ShopSubAccount | undefined

  return (
    !!row &&
    typeof row.id === 'string' &&
    !!row.id &&
    row.profileId === profileId &&
    typeof row.subAccount === 'string' &&
    typeof row.enabled === 'boolean' &&
    typeof row.hasPassword === 'boolean' &&
    typeof row.createdAt === 'string' &&
    typeof row.updatedAt === 'string' &&
    validRevision(row.revision)
  )
}

function mailboxMetadata(row: ShopMailbox): ShopMailbox {
  return { providerKey: row.providerKey, user: row.user, hasPassword: row.hasPassword, revision: row.revision }
}

function subAccountMetadata(row: ShopSubAccount): ShopSubAccount {
  return {
    id: row.id,
    profileId: row.profileId,
    subAccount: row.subAccount,
    enabled: row.enabled,
    hasPassword: row.hasPassword,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision
  }
}

/** These routes are the enterprise server contract, scoped by the main-owned session. */
export function nativeBusinessAdminApi(runtime: EnterpriseClientRuntime) {
  const post = async <T>(path: string, body: unknown) => {
    if (!runtime.post) {
      throw new Error('SHOP_BUSINESS_ADMIN_UNAVAILABLE')
    }

    return runtime.post<T>(path, body)
  }

  return {
    async setSeatStatus(principalId: string, status: 'active' | 'disabled') {
      if (typeof principalId !== 'string' || !/\S/.test(principalId) || !['active', 'disabled'].includes(status)) {
        throw new Error('SHOP_SEAT_STATUS_REJECTED')
      }

      const result = await post<{ principal?: { principal_id?: unknown; status?: unknown } }>(
        '/api/principals-status', { principal_id: principalId, status }
      )

      if (
        !result || Object.keys(result).length !== 1 ||
        !result.principal || Object.keys(result.principal).length !== 2 ||
        result.principal.principal_id !== principalId || result.principal.status !== status
      ) {
        throw new Error('SHOP_SEAT_STATUS_RESPONSE_INVALID')
      }
    },
    async resetSeatPassword(principalId: string, password: string) {
      if (!principalId || Array.from(password).length < 6 || Array.from(password).length > 256) {
        throw new Error('SHOP_PASSWORD_RESET_REJECTED')
      }

      const result = await post<{ principal?: { principal_id?: unknown; must_change_password?: unknown } }>(
        '/api/principals-password-reset', { principal_id: principalId, new_password: password }
      )

      if (result?.principal?.principal_id !== principalId || result.principal.must_change_password !== true) {
        throw new Error('SHOP_PASSWORD_RESET_RESPONSE_INVALID')
      }
    },
    async getMailbox() {
      const result = await runtime.get<{ mailbox: ShopMailbox }>('/api/shop-mailbox')

      if (!validShopMailbox(result.mailbox)) {
        throw new Error('SHOP_MAILBOX_RESPONSE_INVALID')
      }

      return mailboxMetadata(result.mailbox)
    },
    async saveMailbox(draft: { providerKey: 'qq' | '126'; user: string; password?: string; expectedRevision: number }) {
      const result = await post<{ mailbox: ShopMailbox }>('/api/shop-mailbox', draft)

      if (
        !validShopMailbox(result.mailbox) ||
        result.mailbox.revision <= draft.expectedRevision ||
        result.mailbox.user !== draft.user ||
        result.mailbox.providerKey !== draft.providerKey
      ) {
        throw new Error('SHOP_MAILBOX_RESPONSE_INVALID')
      }

      return mailboxMetadata(result.mailbox)
    },
    async testMailbox(draft: { providerKey: 'qq' | '126'; user: string; password?: string; expectedRevision: number }) {
      const result = await post<{ ok: boolean }>('/api/shop-mailbox-test', draft)

      if (result.ok !== true) {
        throw new Error('SHOP_MAILBOX_TEST_FAILED')
      }
    },
    async listSubAccounts(profileId: string) {
      const result = await runtime.get<{ subAccounts: ShopSubAccount[] }>(
        `/api/shop-subaccounts?profileId=${encodeURIComponent(profileId)}`
      )

      if (!Array.isArray(result.subAccounts) || !result.subAccounts.every(row => validShopSubAccount(row, profileId))) {
        throw new Error('SHOP_SUBACCOUNTS_RESPONSE_INVALID')
      }

      return result.subAccounts.map(subAccountMetadata)
    },
    async saveSubAccount(draft: ShopSubAccountDraft) {
      const result = await post<{ subAccount: ShopSubAccount }>('/api/shop-subaccounts', draft)

      if (
        !validShopSubAccount(result.subAccount, draft.profileId) ||
        (draft.id && result.subAccount.id !== draft.id) ||
        result.subAccount.revision <= draft.expectedRevision ||
        result.subAccount.subAccount !== draft.subAccount ||
        result.subAccount.enabled !== draft.enabled
      ) {
        throw new Error('SHOP_SUBACCOUNTS_RESPONSE_INVALID')
      }

      return subAccountMetadata(result.subAccount)
    },
    async deleteSubAccount(row: ShopSubAccount) {
      const result = await post<{ deleted: boolean }>('/api/shop-subaccounts-delete', {
        id: row.id,
        profileId: row.profileId,
        expectedRevision: row.revision
      })

      if (result.deleted !== true) {
        throw new Error('SHOP_SUBACCOUNT_DELETE_FAILED')
      }
    }
  }
}

export function businessAdminErrorKey(
  reason: unknown
): 'unavailable' | 'forbidden' | 'conflict' | 'failed' | 'rejected' {
  const status = (reason as { status?: number } | undefined)?.status

  if (
    status === 400 ||
    status === 422 ||
    (reason instanceof Error &&
      ['SHOP_ASSIGNMENT_MEMBERS_UNVERIFIED', 'SHOP_ASSIGNMENT_REJECTED'].includes(reason.message))
  ) {
    return 'rejected'
  }

  if (status === 401 || status === 403) {
    return 'forbidden'
  }

  if (status === 409) {
    return 'conflict'
  }

  if (
    status === 404 ||
    status === 500 ||
    status === 503 ||
    (reason instanceof Error && reason.message.endsWith('_UNAVAILABLE'))
  ) {
    return 'unavailable'
  }

  return 'failed'
}
