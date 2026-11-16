import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type CloudShopRecord,
  createShopProfileCloud,
  isShopProfileCredentialRequest,
  type PortableShopSession,
  validatePortableShopSession
} from './shop-browser-cloud'
import { ShopBrowserProfiles } from './shop-browser-profiles'
import type { ShopBrowserRequest } from './shop-browser-types'
import type { ShopPayoutSettings } from './shop-payout-settings'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true })
  }
})

const portable: PortableShopSession = {
  version: 1,
  cookies: [
    {
      name: 'synthetic_login',
      value: 'synthetic-value',
      domain: '.jinritemai.com',
      path: '/',
      secure: true,
      httpOnly: true,
      hostOnly: false,
      sameSite: 'lax'
    }
  ],
  origins: [{ origin: 'https://fxg.jinritemai.com', localStorage: [['synthetic-key', 'synthetic-value']] }]
}

const bounds = { x: 0, y: 0, width: 800, height: 600 }

function remoteBoundary() {
  const tenants = new Map<string, Map<string, CloudShopRecord>>()
  const hidden = new Map<string, Set<string>>()

  const request = vi.fn(async (tenant: string, principal: string, method: string, url: string, body?: any) => {
    if (!tenants.has(tenant)) {
      tenants.set(tenant, new Map())
    }

    const records = tenants.get(tenant)!
    const preferenceKey = JSON.stringify([tenant, principal])

    if (!hidden.has(preferenceKey)) {
      hidden.set(preferenceKey, new Set())
    }

    const hiddenIds = hidden.get(preferenceKey)!

    const meta = (record: CloudShopRecord) => {
      const { session: _session, ...rest } = record

      return structuredClone(rest)
    }

    const accessible = (record: CloudShopRecord) => principal === 'admin' ||
      (record.servicing_principal_ids ?? [record.servicing_principal_id]).includes(principal)

    if (method === 'GET' && url === '/api/shop-login-profiles') {
      return {
        profiles: [...records.values()]
          .filter(record => accessible(record) && !hiddenIds.has(record.profile_id))
          .map(meta),
        hidden_profile_ids: [...hiddenIds].filter(id => records.has(id) && accessible(records.get(id)!))
      }
    }

    if (method === 'GET') {
      const id = new URL(url, 'https://enterprise.example').searchParams.get('profile_id')!

      if (!records.has(id) || hiddenIds.has(id) || !accessible(records.get(id)!)) {
        throw new Error('404')
      }

      return { profile: structuredClone(records.get(id)) }
    }

    const old = records.get(body.profile_id)

    if (old && !accessible(old)) {
      throw new Error('403')
    }

    if ((old?.revision ?? 0) !== body.expected_revision || old?.deleted) {
      throw new Error('409: revision_conflict')
    }

    if (url === '/api/shop-login-profiles-delete') {
      hiddenIds.add(body.profile_id)

      return { profile_id: body.profile_id, hidden: true }
    }

    if (url === '/api/shop-login-profiles-assign') {
      if (principal !== 'admin') {
        throw new Error('403')
      }

      if (!old || body.principal_ids.some((id: string) => !['employee-a', 'employee-b', 'supervisor'].includes(id))) {
        throw new Error('404')
      }

      const updated = {
        ...old,
        revision: old.revision + 1,
        servicing_principal_ids: [...body.principal_ids],
        servicing_principal_names: body.principal_ids.map((id: string) => `Name ${id}`),
        servicing_principal_id: body.principal_ids[0] ?? null,
        servicing_principal_name: body.principal_ids[0] ? `Name ${body.principal_ids[0]}` : null
      }

      records.set(updated.profile_id, updated)

      for (const id of body.principal_ids) {
        hidden.get(JSON.stringify([tenant, id]))?.delete(updated.profile_id)
      }

      return { profile: meta(updated) }
    }

    if ('payout_settings' in body) {
      if (!old || old.payout_settings_revision !== body.expected_payout_settings_revision) {
        throw new Error('409: revision_conflict')
      }

      const updated: CloudShopRecord = {
        ...old,
        revision: old.revision + 1,
        updated_at: new Date().toISOString(),
        payout_settings: structuredClone(body.payout_settings),
        payout_settings_revision: body.expected_payout_settings_revision + 1
      }
      records.set(updated.profile_id, updated)

      return { profile: meta(updated) }
    }

    const record: CloudShopRecord = {
      profile_id: body.profile_id,
      revision: body.expected_revision + 1,
      deleted: false,
      updated_at: new Date().toISOString(),
      created_by: old?.created_by ?? principal,
      servicing_principal_id: old?.servicing_principal_id ?? principal,
      ...(old?.servicing_principal_ids ? {
        servicing_principal_ids: old.servicing_principal_ids,
        servicing_principal_names: old.servicing_principal_names
      } : {}),
      payout_settings: old?.payout_settings ?? null,
      payout_settings_revision: old?.payout_settings_revision ?? 0,
      profile: structuredClone(body.profile),
      session: structuredClone(body.session)
    }

    records.set(record.profile_id, record)
    hiddenIds.delete(record.profile_id)

    return { profile: meta(record) }
  })

  const transfer = (profileId: string, principalId: string) => {
    const record = tenants.get('tenant-a')!.get(profileId)!
    record.servicing_principal_id = principalId
    delete record.servicing_principal_ids
    delete record.servicing_principal_names
    record.revision++
  }

  return { request, tenants, transfer }
}

async function computer(remote: ReturnType<typeof remoteBoundary>, principalId = 'employee-a', tenantId = 'tenant-a',
  existingRoot?: string) {
  const root = existingRoot ?? await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-cloud-shop-'))
  if (!existingRoot) roots.push(root)
  let current = true
  let unavailable = false

  const assertCurrent = () => {
    if (!current) {
      throw new Error('SHOP_PROFILE_OWNER_CHANGED')
    }
  }

  const cloud = createShopProfileCloud({
    assertCurrent,
    async request<T>(method, url, body) {
      if (unavailable) {
        throw new Error('503: unavailable')
      }

      return (await remote.request(tenantId, principalId, method, url, body)) as T
    }
  })

  const identify = vi.fn(async () => ({ shopId: '12345', shopName: 'Synthetic shop' }))
  const imported = vi.fn(async (_storage: string, _value: PortableShopSession) => {})
  const exported = vi.fn(async () => structuredClone(portable))
  const cleared = vi.fn(async () => {})
  const closeExecution = vi.fn(async () => {})
  const command = vi.fn(async () => ({}))
  const closeView = vi.fn(async () => {})
  const createExecution = vi.fn(async () => ({ identify, command, close: closeExecution }))

  const controller = new ShopBrowserProfiles({
    root,
    cloud,
    authorize: async () => ({ origin: 'https://enterprise.example', tenantId, principalId,
      role: principalId === 'admin' ? 'tenant_admin' : principalId === 'supervisor' ? 'supervisor' : 'operator' }),
    isCurrent: () => current,
    createView: async () => ({ identify, close: closeView, setBounds() {} }),
    createExecution,
    exportSession: exported,
    importSession: imported,
    clearStorage: cleared
  })

  const call = (action: ShopBrowserRequest['action'], rest: Partial<ShopBrowserRequest> = {}) =>
    controller.operate({ sessionId: 'synthetic', action, ...rest })

  const register = async () => {
    const profile = (await call('create')).profile!
    await call('open', { profileId: profile.id, target: 'merchant', bounds })

    return (await call('identify', { profileId: profile.id })).profile!
  }

  return {
    root,
    call,
    controller,
    cloud,
    register,
    identify,
    imported,
    exported,
    cleared,
    createExecution,
    closeExecution,
    command,
    closeView,
    offline: () => {
      unavailable = true
    },
    online: () => {
      unavailable = false
    },
    logout: () => {
      current = false
      controller.invalidate()
    }
  }
}

const payoutSettings: ShopPayoutSettings = {
  remitAmount: '5.25',
  payoutReviewDays: 21,
  payoutRequireReviewWithinDays: true,
  payoutGoodReviewMode: 0,
  payoutRefundChannel: 'refund_only'
}

describe('tenant cloud shop profile recovery', () => {
  it('lets an assigned supervisor work while personal hiding preserves the other assigned employee and asset', async () => {
    const remote = remoteBoundary()
    const a = await computer(remote)
    const profile = await a.register()
    const admin = await computer(remote, 'admin')

    await admin.call('list')
    expect(
      (
        await admin.call('assign', {
          profileId: profile.id,
          expectedRevision: remote.tenants.get('tenant-a')!.get(profile.id)!.revision,
          principalIds: ['employee-a', 'supervisor']
        })
      ).ok
    ).toBe(true)

    const supervisor = await computer(remote, 'supervisor')

    expect((await supervisor.call('list')).profiles![0].id).toBe(profile.id)
    expect((await supervisor.call('open', { profileId: profile.id, target: 'merchant', bounds })).ok).toBe(true)
    expect(
      (
        await supervisor.call('savePayoutSettings', {
          profileId: profile.id,
          expectedRevision: 0,
          payoutSettings
        })
      ).ok
    ).toBe(true)
    expect(
      (
        await supervisor.call('assign', {
          profileId: profile.id,
          expectedRevision: remote.tenants.get('tenant-a')!.get(profile.id)!.revision,
          principalIds: ['supervisor', 'employee-b']
        })
      ).error
    ).toBe('SHOP_PROFILE_FORBIDDEN')
    await a.call('list')
    expect((await a.call('delete', { profileId: profile.id })).ok).toBe(true)
    expect((await a.call('list')).profiles).toEqual([])
    expect((await supervisor.call('list')).profiles![0].payoutSettings).toEqual(payoutSettings)
    expect(remote.tenants.get('tenant-a')!.get(profile.id)!.servicing_principal_ids).toEqual(['employee-a', 'supervisor'])
    expect(remote.tenants.get('tenant-a')!.get(profile.id)!.session).toEqual(portable)
  })

  it('fences an assignment response after logout and rejects a mismatched returned membership', async () => {
    const remote = remoteBoundary()
    const a = await computer(remote)
    const profile = await a.register()
    const original = structuredClone(remote.tenants.get('tenant-a')!.get(profile.id)!)
    let current = true
    let finish!: (value: unknown) => void

    const response = new Promise((resolve) => {
      finish = resolve
    })

    const cloud = createShopProfileCloud({
      assertCurrent() {
        if (!current) {
          throw new Error('SHOP_PROFILE_OWNER_CHANGED')
        }
      },
      request: async <T,>() => (await response) as T
    })

    const assignment = cloud.assign(profile.id, original.revision, ['employee-b'])

    current = false
    finish({
      profile: {
        ...original,
        revision: original.revision + 1,
        servicing_principal_ids: ['employee-b'],
        servicing_principal_names: [null]
      }
    })
    await expect(assignment).rejects.toThrow('OWNER_CHANGED')
    current = true
    await expect(cloud.assign(profile.id, original.revision, ['employee-a'])).rejects.toThrow('RESPONSE_INVALID')
  })

  it('normalizes legacy assignment and shares through the real Profiles request boundary', async () => {
    const remote = remoteBoundary()
    const a = await computer(remote)
    const profile = await a.register()
    const admin = await computer(remote, 'admin')
    let listing = await admin.call('list')
    expect(listing.profiles![0]).toMatchObject({
      servicingPrincipalIds: ['employee-a'],
      servicingPrincipalNames: [null],
      createdBy: 'employee-a',
      cloudRevision: 1
    })

    const assigned = await admin.call('assign', {
      profileId: profile.id,
      principalIds: ['employee-a', 'employee-b'],
      expectedRevision: 1
    })

    expect(assigned).toMatchObject({
      ok: true,
      profile: {
        servicingPrincipalIds: ['employee-a', 'employee-b'],
        servicingPrincipalNames: ['Name employee-a', 'Name employee-b'],
        cloudRevision: 2
      }
    })
    const b = await computer(remote, 'employee-b')
    expect((await b.call('list')).profiles![0]).toMatchObject({ id: profile.id, loginState: 'verified' })
    expect((await a.call('list')).profiles![0].servicingPrincipalIds).toEqual(['employee-a', 'employee-b'])
    expect((await b.call('open', { profileId: profile.id, target: 'merchant', bounds })).ok).toBe(true)
    const execution = await b.controller.acquireExecution(profile.id, 'merchant')
    await execution.command('root', 'Runtime.evaluate', {})
    await execution.close()
    expect((await b.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 0, payoutSettings })).ok).toBe(
      true
    )
    listing = await admin.call('list')
    const revision = listing.profiles![0].cloudRevision!
    expect(
      (await admin.call('assign', { profileId: profile.id, expectedRevision: revision, principalIds: ['employee-b'] })).ok
    ).toBe(true)
    await a.controller.revalidate()
    expect((await a.call('list')).profiles).toEqual([])
    expect((await b.call('list')).profiles![0].payoutSettings).toEqual(payoutSettings)
    expect(
      (await admin.call('assign', { profileId: profile.id, expectedRevision: revision + 1, principalIds: [] })).ok
    ).toBe(true)
    expect((await b.call('list')).profiles).toEqual([])
    expect((await admin.call('list')).profiles![0].servicingPrincipalIds).toEqual([])
    expect(remote.tenants.get('tenant-a')!.get(profile.id)!.session).toEqual(portable)
  })

  it('refuses employee and supervisor assignment and malformed or stale assignment without a write', async () => {
    const remote = remoteBoundary()
    const a = await computer(remote)
    const profile = await a.register()
    expect(
      (await a.call('assign', { profileId: profile.id, expectedRevision: 1, principalIds: ['employee-b'] })).error
    ).toBe('SHOP_PROFILE_FORBIDDEN')
    const supervisor = await computer(remote, 'supervisor')
    expect((await supervisor.call('assign', { profileId: profile.id, expectedRevision: 1, principalIds: [] })).ok).toBe(
      false
    )
    const admin = await computer(remote, 'admin')
    await admin.call('list')
    const revision = remote.tenants.get('tenant-a')!.get(profile.id)!.revision
    const assignmentWrites = () => remote.request.mock.calls.filter((call) => call[3].endsWith('-assign')).length
    expect(assignmentWrites()).toBe(0)
    await expect(admin.cloud.assign(profile.id, revision, ['employee-a', 'employee-a'])).rejects.toThrow(
      'REQUEST_INVALID'
    )
    await expect(admin.cloud.assign(profile.id, revision, [' foreign '])).rejects.toThrow('REQUEST_INVALID')
    expect(assignmentWrites()).toBe(0)
    await expect(admin.cloud.assign(profile.id, revision, ['missing'])).rejects.toThrow('404')
    await expect(admin.cloud.assign(profile.id, revision + 1, [])).rejects.toThrow('409')
    expect(remote.tenants.get('tenant-a')!.get(profile.id)!.revision).toBe(revision)
  })

  it('rejects malformed assignment arrays and derives legacy fields from the authoritative arrays', async () => {
    const remote = remoteBoundary()
    const a = await computer(remote)
    const profile = await a.register()
    const raw = remote.tenants.get('tenant-a')!.get(profile.id)!
    raw.servicing_principal_ids = ['employee-b']
    raw.servicing_principal_names = [null]
    const admin = await computer(remote, 'admin')
    expect((await admin.cloud.list()).profiles[0]).toMatchObject({
      servicing_principal_id: 'employee-b',
      servicing_principal_name: null,
      servicing_principal_ids: ['employee-b']
    })
    raw.servicing_principal_names = []
    await expect(admin.cloud.list()).rejects.toThrow('RESPONSE_INVALID')
    raw.servicing_principal_names = [null, null]
    raw.servicing_principal_ids = ['employee-b', 'employee-b']
    await expect(admin.cloud.get(profile.id)).rejects.toThrow('RESPONSE_INVALID')
  })

  it('retains cloud payout configuration when a newer login session replaces storage and enforces transfer revocation', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()

    const settings = { remitAmount: '5', payoutReviewDays: 15, payoutRequireReviewWithinDays: true,
      payoutGoodReviewMode: 0 as const, payoutRefundChannel: 'refund_only' as const }

    expect((await first.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 0, payoutSettings: settings })).ok).toBe(true)
    await first.call('close')
    remote.transfer(profile.id, 'employee-a')
    const reply = await first.call('list')

    expect(reply.profiles![0]).toMatchObject({ payoutSettings: settings, payoutSettingsRevision: 1 })
    remote.transfer(profile.id, 'employee-b')
    expect((await first.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 1, payoutSettings: settings })).error).toBe('SHOP_PROFILE_FORBIDDEN')
    expect((await first.call('list')).profiles).toEqual([])
  })
  it('keeps credential endpoints main-owned while allowing metadata and service assignment', () => {
    expect(isShopProfileCredentialRequest('GET', '/api/shop-login-profile')).toBe(true)
    expect(isShopProfileCredentialRequest('POST', '/api/shop-login-profiles')).toBe(true)
    expect(isShopProfileCredentialRequest('GET', '/api/shop-login-profiles')).toBe(false)
    expect(isShopProfileCredentialRequest('POST', '/api/shop-login-profiles-transfer')).toBe(false)
  })
  it('saves a verified enterprise asset and restores it for the same employee on another computer', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const record = remote.tenants.get('tenant-a')!.get(profile.id)!
    expect(record.session).toEqual(portable)
    expect(record.revision).toBe(1)
    const second = await computer(remote)
    const reply = await second.call('list')
    expect(reply.ok).toBe(true)
    expect(reply.cloud?.state).toBe('synced')
    expect(reply.profiles).toEqual([
      expect.objectContaining({ id: profile.id, shopId: '12345', principalId: 'employee-a', loginState: 'verified' })
    ])
    expect(second.imported).toHaveBeenCalledOnce()
    expect(second.imported.mock.calls[0][1]).toEqual(portable)
    expect(second.identify).toHaveBeenCalledOnce()
    expect(JSON.stringify(reply)).not.toContain('synthetic-value')
    const execution = await second.controller.acquireExecution(profile.id, 'feige')
    expect(execution.shopId).toBe('12345')
    expect(second.identify).toHaveBeenCalledTimes(2)
    await execution.close()
    await second.call('list')
  })

  it('keeps another tenant empty and rejects a late cloud restore after logout', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    await first.register()
    const other = await computer(remote, 'employee-b', 'tenant-b')
    expect((await other.call('list')).profiles).toEqual([])
    expect(other.imported).not.toHaveBeenCalled()
    const second = await computer(remote)
    let release!: () => void

    const entered = new Promise<void>(resolve => {
      second.imported.mockImplementationOnce(async () => {
        resolve()
        await new Promise<void>(done => {
          release = done
        })
      })
    })

    const listing = second.call('list')
    await entered
    second.logout()
    release()
    expect((await listing).error).toBe('SHOP_PROFILE_OWNER_CHANGED')
    expect(second.createExecution).not.toHaveBeenCalled()
    expect(second.cleared).toHaveBeenCalledOnce()
    const files = await fs.readdir(second.root, { recursive: true })
    expect(files.some(file => String(file).endsWith('profiles.json'))).toBe(false)
  })

  it('does not call a restored but expired login verified', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const second = await computer(remote)
    second.identify.mockResolvedValueOnce(null as never)
    const reply = await second.call('list')
    expect(reply.profiles?.[0].loginState).toBe('expired')
    await expect(second.controller.acquireExecution(profile.id, 'merchant')).rejects.toThrow('UNVERIFIED')
    expect(second.createExecution).toHaveBeenCalledOnce()
  })

  it('retains local profiles and reports cloud outage without fabricating synchronization', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    first.offline()
    const profile = await first.register()
    const reply = await first.call('list')
    expect(reply.cloud?.state).toBe('unavailable')
    expect(reply.profiles?.[0].id).toBe(profile.id)
    expect(reply.profiles?.[0].loginState).toBe('verified')
    expect(remote.tenants.size).toBe(0)
    expect(first.exported).not.toHaveBeenCalled()
  })

  it('does not replace the cloud login with a different shop selected in the same page', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const before = structuredClone(remote.tenants.get('tenant-a')!.get(profile.id))
    first.identify.mockResolvedValueOnce({ shopId: '99999', shopName: 'Other shop' })
    await first.call('close')
    expect(remote.tenants.get('tenant-a')!.get(profile.id)).toEqual(before)
    expect((await first.call('list')).profiles?.[0].loginState).toBe('expired')
  })

  it('retains the remote revision on a stale backup and never silently overwrites another computer', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const second = await computer(remote)
    await second.call('list')
    await second.call('open', { profileId: profile.id, target: 'merchant', bounds })
    await second.call('identify', { profileId: profile.id })
    const current = structuredClone(remote.tenants.get('tenant-a')!.get(profile.id)!)
    expect(current.revision).toBe(2)
    const stale = await first.call('identify', { profileId: profile.id })
    expect(stale.ok).toBe(true)
    expect(stale.cloud?.state).toBe('conflict')
    expect(remote.tenants.get('tenant-a')!.get(profile.id)).toEqual(current)
  })

  it('removes only the employee listing and preserves the enterprise asset and login for administrators', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const before = structuredClone(remote.tenants.get('tenant-a')!.get(profile.id))
    const deleted = await first.call('delete', { profileId: profile.id })
    expect(deleted.ok).toBe(true)
    expect(remote.tenants.get('tenant-a')!.get(profile.id)).toEqual(before)
    expect(remote.tenants.get('tenant-a')!.size).toBe(1)
    expect((await first.call('list')).profiles).toEqual([])
    const sameEmployeeNewComputer = await computer(remote)
    expect((await sameEmployeeNewComputer.call('list')).profiles).toEqual([])
    expect(sameEmployeeNewComputer.imported).not.toHaveBeenCalled()
    const coworker = await computer(remote, 'admin')
    expect((await coworker.call('list')).profiles).toEqual([
      expect.objectContaining({ id: profile.id, loginState: 'verified' })
    ])
    expect(coworker.imported.mock.calls[0][1]).toEqual(portable)
  })

  it('removes an already restored listing on another computer of the same employee', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const second = await computer(remote)
    expect((await second.call('list')).profiles).toHaveLength(1)
    await first.call('delete', { profileId: profile.id })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000)

    try {
      expect((await second.call('list')).profiles).toEqual([])
      expect(second.cleared).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
    }

    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.session).toEqual(portable)
  })

  it('resets only local login, keeps the shared asset binding, and updates the same asset after reauthentication', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const before = structuredClone(remote.tenants.get('tenant-a')!.get(profile.id))
    const reset = await first.call('relogin', { profileId: profile.id })
    expect(reset.profile).toMatchObject({ id: profile.id, shopId: '12345', loginState: 'unverified' })
    expect(remote.tenants.get('tenant-a')!.get(profile.id)).toEqual(before)
    await first.call('open', { profileId: profile.id, target: 'merchant', bounds })
    first.identify.mockResolvedValueOnce({ shopId: '99999', shopName: 'Other shop' })
    expect((await first.call('identify', { profileId: profile.id })).error).toBe('SHOP_PROFILE_IDENTITY_CHANGED')
    expect(remote.tenants.get('tenant-a')!.get(profile.id)).toEqual(before)
    await first.call('open', { profileId: profile.id, target: 'merchant', bounds })
    const verified = await first.call('identify', { profileId: profile.id })
    expect(verified.profile?.id).toBe(profile.id)
    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.revision).toBe(2)
    expect(remote.request.mock.calls.some(call => call[3] === '/api/shop-login-profiles-delete')).toBe(false)
  })

  it('defers a personal removal on another computer until its active execution releases the profile', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const second = await computer(remote)
    await second.call('list')
    const execution = await second.controller.acquireExecution(profile.id, 'merchant')
    await first.call('delete', { profileId: profile.id })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000)

    try {
      expect((await second.call('list')).profiles).toHaveLength(1)
      expect(second.cleared).not.toHaveBeenCalled()
      let release!: () => void
      second.closeExecution.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            release = resolve
          })
      )
      const closing = execution.close()
      expect((await second.call('list')).profiles).toHaveLength(1)
      expect(second.cleared).not.toHaveBeenCalled()
      release()
      await closing
      expect((await second.call('list')).profiles).toEqual([])
      expect(second.cleared).toHaveBeenCalledOnce()
      await expect(second.controller.acquireExecution(profile.id, 'merchant')).rejects.toThrow('UNVERIFIED')
    } finally {
      clock.mockRestore()
    }

    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.session).toEqual(portable)
  })

  it('keeps the usable local profile when personal removal cannot be saved to the server', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    first.offline()
    expect((await first.call('delete', { profileId: profile.id })).ok).toBe(false)
    expect(first.cleared).not.toHaveBeenCalled()
    expect((await first.call('list')).profiles).toEqual([])
    await expect(first.controller.acquireExecution(profile.id, 'merchant')).rejects.toThrow('ACCESS_UNAVAILABLE')
    const files = await fs.readdir(first.root, { recursive: true })
    expect(files.some(file => String(file).endsWith('profiles.json'))).toBe(true)
    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.session).toEqual(portable)
  })

  it('hides a transferred asset from A, rejects stale local IDs and allows only B and the administrator', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const unrelated = await computer(remote, 'employee-other')
    expect((await unrelated.call('list')).profiles).toEqual([])
    remote.transfer(profile.id, 'employee-b')
    expect((await first.call('open', { profileId: profile.id, target: 'merchant', bounds })).error).toBe(
      'SHOP_PROFILE_FORBIDDEN'
    )
    expect((await first.call('list')).profiles).toEqual([])
    expect(first.cleared).toHaveBeenCalledOnce()
    await expect(first.controller.acquireExecution(profile.id, 'merchant')).rejects.toThrow('UNVERIFIED')
    const second = await computer(remote, 'employee-b')
    const admin = await computer(remote, 'admin')
    expect((await second.call('list')).profiles).toEqual([
      expect.objectContaining({ id: profile.id, loginState: 'verified' })
    ])
    expect((await admin.call('list')).profiles).toEqual([
      expect.objectContaining({ id: profile.id, loginState: 'verified' })
    ])
    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.created_by).toBe('employee-a')
    expect(second.imported.mock.calls[0][1]).toEqual(portable)
    expect(
      remote.request.mock.calls.filter(
        call => call[1] === 'employee-a' && call[2] === 'POST' && call[3] === '/api/shop-login-profiles'
      )
    ).toHaveLength(1)
  })

  it('periodically revokes the old open view and execution and never dispatches another browser command', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const execution = await first.controller.acquireExecution(profile.id, 'merchant')
    await execution.command('root', 'Runtime.evaluate', {})
    expect(first.command).toHaveBeenCalledOnce()
    remote.transfer(profile.id, 'employee-b')
    await first.controller.revalidate()
    expect(first.closeView).toHaveBeenCalledOnce()
    expect(first.closeExecution).toHaveBeenCalledOnce()
    await expect(execution.command('root', 'Runtime.evaluate', {})).rejects.toThrow('OWNER_CHANGED')
    expect(first.command).toHaveBeenCalledOnce()
    expect((await first.call('list')).profiles).toEqual([])
    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.session).toEqual(portable)
  })

  it('waits for a revoked execution to close before clearing its local partition', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const execution = await first.controller.acquireExecution(profile.id, 'merchant')
    let release!: () => void
    let entered!: () => void

    const closing = new Promise<void>(resolve => {
      entered = resolve
    })

    first.closeExecution.mockImplementationOnce(() => {
      entered()

      return new Promise<void>(resolve => {
        release = resolve
      })
    })
    remote.transfer(profile.id, 'employee-b')
    const revalidation = first.controller.revalidate()
    await closing
    expect(first.cleared).not.toHaveBeenCalled()
    await expect(execution.command('root', 'Runtime.evaluate', {})).rejects.toThrow('OWNER_CHANGED')
    release()
    await revalidation
    expect(first.cleared).toHaveBeenCalledOnce()
    expect((await first.call('list')).profiles).toEqual([])
  })

  it('rejects domains, origins and malformed payloads before any native storage write', () => {
    const bad = [
      { ...portable, cookies: [{ ...portable.cookies[0], domain: 'jinritemai.com.attacker.test' }] },
      { ...portable, origins: [{ origin: 'http://fxg.jinritemai.com', localStorage: [] }] },
      { ...portable, origins: [{ origin: 'https://attacker.test', localStorage: [] }] },
      { ...portable, origins: [{ origin: 'https://fxg.jinritemai.com', localStorage: [['key', 4]] }] },
      { ...portable, cookies: [{ ...portable.cookies[0], expirationDate: Infinity }] }
    ]

    for (const value of bad) {
      expect(() => validatePortableShopSession(value)).toThrow('SESSION_INVALID')
    }

    expect(validatePortableShopSession(portable)).toBe(portable)
  })
})

describe('enterprise-owned cloud payout settings', () => {
  it('keeps different shop amounts, review conditions and refund channels separate on recovery', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const shopA = await first.register()
    await first.call('savePayoutSettings', { profileId: shopA.id, expectedRevision: 0, payoutSettings })
    await first.call('close')
    first.identify.mockResolvedValue({ shopId: '67890', shopName: 'Another synthetic shop' })
    const shopB = await first.register()
    const settingsB: ShopPayoutSettings = {
      remitAmount: '12.80', payoutReviewDays: 7, payoutRequireReviewWithinDays: false,
      payoutGoodReviewMode: 1, payoutRefundChannel: 'small_remit'
    }
    await first.call('savePayoutSettings', { profileId: shopB.id, expectedRevision: 0, payoutSettings: settingsB })
    const second = await computer(remote)
    second.identify.mockResolvedValueOnce({ shopId: '12345', shopName: 'Synthetic shop' })
      .mockResolvedValueOnce({ shopId: '67890', shopName: 'Another synthetic shop' })
    const recovered = (await second.call('list')).profiles!
    expect(recovered.find(item => item.id === shopA.id)).toMatchObject({
      payoutSettings, payoutSettingsRevision: 1, loginState: 'verified'
    })
    expect(recovered.find(item => item.id === shopB.id)).toMatchObject({
      payoutSettings: settingsB, payoutSettingsRevision: 1, loginState: 'verified'
    })
  })

  it('restores all five settings on a fresh computer and after restarting the profile store', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const saved = await first.call('savePayoutSettings', {
      profileId: profile.id, expectedRevision: 0, payoutSettings
    })
    expect(saved).toMatchObject({ ok: true, profile: { payoutSettings, payoutSettingsRevision: 1 } })
    const value = remote.tenants.get('tenant-a')!.get(profile.id)!
    expect(value).toMatchObject({ payout_settings: payoutSettings, payout_settings_revision: 1 })
    expect(value.session).toEqual(portable)
    const second = await computer(remote)
    expect(second.root).not.toBe(first.root)
    expect((await second.call('list')).profiles?.[0]).toMatchObject({
      id: profile.id, payoutSettings, payoutSettingsRevision: 1
    })
    await first.call('close')
    const restarted = await computer(remote, 'employee-a', 'tenant-a', first.root)
    expect((await restarted.call('list')).profiles?.[0]).toMatchObject({ payoutSettings, payoutSettingsRevision: 1 })
    expect(JSON.stringify(saved)).not.toContain('synthetic-value')
  })

  it('keeps the settings with the asset after transfer, hiding A and restoring only for B and admin', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    await first.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 0, payoutSettings })
    remote.transfer(profile.id, 'employee-b')
    expect((await first.call('list')).profiles).toEqual([])
    expect((await first.call('savePayoutSettings', {
      profileId: profile.id, expectedRevision: 1, payoutSettings: { ...payoutSettings, remitAmount: '99' }
    })).ok).toBe(false)
    for (const principal of ['employee-b', 'admin']) {
      const next = await computer(remote, principal)
      expect((await next.call('list')).profiles?.[0]).toMatchObject({
        id: profile.id, principalId: principal, payoutSettings, payoutSettingsRevision: 1
      })
    }
    const unrelated = await computer(remote, 'supervisor')
    expect((await unrelated.call('list')).profiles).toEqual([])
    const otherTenant = await computer(remote, 'employee-b', 'tenant-b')
    expect((await otherTenant.call('list')).profiles).toEqual([])
    expect(remote.tenants.get('tenant-a')!.get(profile.id)).toMatchObject({
      created_by: 'employee-a', servicing_principal_id: 'employee-b', payout_settings: payoutSettings
    })
  })

  it('rejects a stale configuration edit and refreshes an open profile without replacing its browser session', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    await first.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 0, payoutSettings })
    const second = await computer(remote)
    await second.call('list')
    const newer = { ...payoutSettings, remitAmount: '12.80', payoutReviewDays: 30, payoutGoodReviewMode: 1 as const }
    expect((await second.call('savePayoutSettings', {
      profileId: profile.id, expectedRevision: 1, payoutSettings: newer
    })).profile).toMatchObject({ payoutSettings: newer, payoutSettingsRevision: 2 })
    expect((await first.call('savePayoutSettings', {
      profileId: profile.id, expectedRevision: 1, payoutSettings: { ...payoutSettings, remitAmount: '77' }
    })).error).toBe('SHOP_PAYOUT_SETTINGS_CONFLICT')
    expect((await first.call('list')).profiles?.[0]).toMatchObject({ payoutSettings: newer, payoutSettingsRevision: 2 })
    expect(first.imported).not.toHaveBeenCalled()
    expect(first.closeView).not.toHaveBeenCalled()
    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.payout_settings).toEqual(newer)
  })

  it('preserves settings on login backup and personal removal while allowing the administrator to recover them', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    await first.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 0, payoutSettings })
    await first.call('close')
    expect(remote.tenants.get('tenant-a')!.get(profile.id)).toMatchObject({
      payout_settings: payoutSettings, payout_settings_revision: 1, session: portable
    })
    expect((await first.call('delete', { profileId: profile.id })).ok).toBe(true)
    expect((await first.call('list')).profiles).toEqual([])
    const admin = await computer(remote, 'admin')
    expect((await admin.call('list')).profiles?.[0]).toMatchObject({ payoutSettings, payoutSettingsRevision: 1 })
  })

  it('migrates a pre-cloud local configuration once without changing the existing login', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    await first.call('close')
    const files = await fs.readdir(first.root, { recursive: true })
    const store = path.join(first.root, String(files.find(file => String(file).endsWith('profiles.json'))))
    const local = JSON.parse(await fs.readFile(store, 'utf8'))
    Object.assign(local.profiles[0], { payoutSettings, payoutSettingsRevision: 7 })
    await fs.writeFile(store, JSON.stringify(local))
    const before = structuredClone(remote.tenants.get('tenant-a')!.get(profile.id)!.session)
    const restart = await computer(remote, 'employee-a', 'tenant-a', first.root)
    expect((await restart.call('list')).profiles?.[0]).toMatchObject({ payoutSettings, payoutSettingsRevision: 1 })
    await restart.call('list')
    expect(remote.request.mock.calls.filter(call => call[4]?.payout_settings)).toHaveLength(1)
    expect(remote.tenants.get('tenant-a')!.get(profile.id)!.session).toEqual(before)
  })

  it('uploads settings saved before shop identification when the verified asset is first backed up', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = (await first.call('create')).profile!
    expect((await first.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 0, payoutSettings })).ok).toBe(true)
    expect(remote.tenants.size).toBe(0)
    await first.call('open', { profileId: profile.id, target: 'merchant', bounds })
    expect((await first.call('identify', { profileId: profile.id })).profile).toMatchObject({
      payoutSettings, payoutSettingsRevision: 1
    })
    expect(remote.tenants.get('tenant-a')!.get(profile.id)).toMatchObject({ payout_settings: payoutSettings })
  })

  it('does not report a successful save or replace local data after a cloud write fails', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    await first.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 0, payoutSettings })
    const original = remote.request.getMockImplementation()!
    remote.request.mockImplementation(async (...args) => {
      if (args[2] === 'POST' && args[4]?.payout_settings) throw new Error('500: unavailable')
      return original(...args)
    })
    expect((await first.call('savePayoutSettings', {
      profileId: profile.id, expectedRevision: 1, payoutSettings: { ...payoutSettings, remitAmount: '88' }
    })).error).toBe('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
    expect(first.closeView).not.toHaveBeenCalled()
    expect((await first.call('list')).profiles?.[0]).toMatchObject({ payoutSettings, payoutSettingsRevision: 1 })
    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.payout_settings).toEqual(payoutSettings)
  })

  it('keeps an old server compatible for login but refuses to claim a cloud configuration save', async () => {
    const remote = remoteBoundary()
    const original = remote.request.getMockImplementation()!
    remote.request.mockImplementation(async (...args) => {
      const result = await original(...args)
      const strip = (record: any) => {
        delete record.payout_settings
        delete record.payout_settings_revision
      }
      if ('profiles' in result) result.profiles.forEach(strip)
      if ('profile' in result) strip(result.profile)
      return result
    })
    const first = await computer(remote)
    const profile = await first.register()
    expect(profile.loginState).toBe('verified')
    expect((await first.call('savePayoutSettings', {
      profileId: profile.id, expectedRevision: 0, payoutSettings
    })).error).toBe('SHOP_PAYOUT_SETTINGS_CLOUD_UNAVAILABLE')
    expect(remote.request.mock.calls.filter(call => call[4]?.payout_settings)).toHaveLength(0)
    expect((await first.call('list')).profiles?.[0].payoutSettings).toBeUndefined()
  })

  it('rejects the configuration race at the server boundary instead of retrying or overwriting', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const original = remote.request.getMockImplementation()!
    remote.request.mockImplementation(async (...args) => {
      if (args[2] === 'POST' && args[4]?.payout_settings) {
        const row = remote.tenants.get('tenant-a')!.get(profile.id)!
        row.payout_settings = { ...payoutSettings, remitAmount: '9' }
        row.payout_settings_revision = 1
        row.revision++
      }
      return original(...args)
    })
    expect((await first.call('savePayoutSettings', {
      profileId: profile.id, expectedRevision: 0, payoutSettings
    })).error).toBe('SHOP_PAYOUT_SETTINGS_CONFLICT')
    expect(remote.request.mock.calls.filter(call => call[4]?.payout_settings)).toHaveLength(1)
    expect(remote.tenants.get('tenant-a')!.get(profile.id)?.payout_settings?.remitAmount).toBe('9')
  })

  it('fences a late cloud configuration response after logout', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const original = remote.request.getMockImplementation()!
    let finish!: () => void
    let entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    remote.request.mockImplementation(async (...args) => {
      const value = await original(...args)
      if (args[2] === 'POST' && args[4]?.payout_settings) {
        entered()
        await new Promise<void>(resolve => { finish = resolve })
      }
      return value
    })
    const saving = first.call('savePayoutSettings', { profileId: profile.id, expectedRevision: 0, payoutSettings })
    await waiting
    first.logout()
    finish()
    expect((await saving).error).toBe('SHOP_PROFILE_OWNER_CHANGED')
    const files = await fs.readdir(first.root, { recursive: true })
    const stored = await fs.readFile(path.join(first.root, String(files.find(file => String(file).endsWith('profiles.json')))), 'utf8')
    expect(JSON.parse(stored).profiles[0].payoutSettings).toBeUndefined()
  })

  it('refuses malformed cloud configuration instead of restoring it into a new profile', async () => {
    const remote = remoteBoundary()
    const first = await computer(remote)
    const profile = await first.register()
    const record = remote.tenants.get('tenant-a')!.get(profile.id)!
    for (const change of [
      { payout_settings: payoutSettings, payout_settings_revision: 0 },
      { payout_settings: null, payout_settings_revision: 1 },
      { payout_settings: { ...payoutSettings, payoutReviewDays: false }, payout_settings_revision: 1 },
      { payout_settings: { ...payoutSettings, remitAmount: '' }, payout_settings_revision: 1 }
    ]) {
      Object.assign(record, change)
      const next = await computer(remote)
      const reply = await next.call('list')
      expect(reply.cloud?.state).toBe('unavailable')
      expect(reply.profiles).toEqual([])
      expect(next.imported).not.toHaveBeenCalled()
    }
  })
})
