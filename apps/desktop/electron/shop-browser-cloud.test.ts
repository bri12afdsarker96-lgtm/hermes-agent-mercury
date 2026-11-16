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

    const accessible = (record: CloudShopRecord) => principal === 'admin' || record.servicing_principal_id === principal

    if (method === 'GET' && url === '/api/shop-login-profiles') {
      return {
        profiles: [...records.values()]
          .filter(record => accessible(record) && !hiddenIds.has(record.profile_id))
          .map(meta),
        hidden_profile_ids: [...hiddenIds]
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

    const record: CloudShopRecord = {
      profile_id: body.profile_id,
      revision: body.expected_revision + 1,
      deleted: false,
      updated_at: new Date().toISOString(),
      created_by: old?.created_by ?? principal,
      servicing_principal_id: old?.servicing_principal_id ?? principal,
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
    record.revision++
  }

  return { request, tenants, transfer }
}

async function computer(remote: ReturnType<typeof remoteBoundary>, principalId = 'employee-a', tenantId = 'tenant-a') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-cloud-shop-'))
  roots.push(root)
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
    authorize: async () => ({ origin: 'https://enterprise.example', tenantId, principalId }),
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
    logout: () => {
      current = false
      controller.invalidate()
    }
  }
}

describe('tenant cloud shop profile recovery', () => {
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
