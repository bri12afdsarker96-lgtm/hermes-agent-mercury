import { describe, expect, it, vi } from 'vitest'
import { DoudianController, assertDoudianCapability } from './doudian-host'
import type { DoudianRequest } from './doudian-types'

const shopId = 'b'.repeat(32)
const token = 'c'.repeat(32)
const shop = { id: shopId, name: 'Test shop', alias: null, pinned: false, sortOrder: 0, pendingLogin: false, pendingDeletion: false, status: 'ready', verifiedName: null, platformId: null, feigeStatus: null, checkedAt: null, feigeCheckedAt: null, privatePath: 'must-not-leak' }

function fixture() {
  let owner = 'a'.repeat(64)
  let capability: unknown = 1
  let current = true
  let online = true
  const request = vi.fn(async (method: string) => {
    if (method === 'initialize') return { protocol: 1, version: '1.0.54', integration: 'hermes-review-v1', taskIsolation: 'hermes-task-isolation-v1', authorizationMode: 'enterprise-session-v1' }
    if (method === 'capabilities') return { authorized: true, authorizationMode: 'enterprise-session-v1', shopManagement: capability, shopOperations: capability }
    if (method === 'shopManagementList') return [shop]
    if (['shopLoginStart', 'shopOperationStatus', 'shopLoginConfirm', 'shopOperationCancel'].includes(method)) return { taskId: token, shopId, kind: 'shop-login', state: 'awaiting_confirmation', phase: 'confirm_identity', candidate: { name: 'Shop A', platformId: '123' }, bound: { name: null, platformId: null }, merchantStatus: null, feigeStatus: null, bindingSaved: false, error: null, cookie: 'must-not-leak' }
    if (method === 'shopManagementPrepareDelete') return { confirmation: token, expiresSeconds: 120, effect: 'delete_local_profiles_and_list_keep_history' }
    if (method === 'shopManagementDelete') return { taskId: token, kind: 'shop-delete', state: 'running', saved: 0, summary: '', error: '', messages: [] }
    return { updated: true }
  })
  const host = { request, close: vi.fn() }
  const controller = new DoudianController({ platform: 'win32', root: '', authorize: async () => { if (!online) throw new Error('OFFLINE'); return owner }, isCurrent: () => current,
    chooseWorkbook: async () => null, verify: async () => 'fixture', createHost: () => host })
  const call = (action: DoudianRequest['action'], fields: Partial<DoudianRequest> = {}) => controller.operate({ sessionId: 'test', action, ...fields })
  return { call, host, setOwner: (value: string) => { owner = value }, setCurrent: (value: boolean) => { current = value }, setOnline: (value: boolean) => { online = value }, setCapability: (value: unknown) => { capability = value } }
}

describe('embedded shop management through the actual controller', () => {
  it('requires the existing review capability', () => {
    expect(() => assertDoudianCapability({}, 'shopManagementList')).toThrow('DOUDIAN_FORBIDDEN')
    expect(() => assertDoudianCapability({ product_capabilities: { doudian_review: { enabled: true, status: 'LIVE' } } }, 'shopManagementList')).not.toThrow()
  })
  it('rejects old hosts before issuing management calls', async () => {
    const f = fixture(); f.setCapability(undefined)
    expect(await f.call('shopManagementList')).toEqual({ ok: false, error: 'SHOP_MANAGEMENT_UNSUPPORTED' })
    expect(f.host.request).not.toHaveBeenCalledWith('shopManagementList', expect.anything())
  })
  it('returns only allowed shop fields and validates mutation arguments', async () => {
    const f = fixture()
    expect(await f.call('shopManagementList')).toEqual({ ok: true, managedShops: [{ id: shopId, name: shop.name, alias: null, pinned: false, sortOrder: 0, pendingLogin: false, pendingDeletion: false, status: 'ready', verifiedName: null, platformId: null, feigeStatus: null, checkedAt: null, feigeCheckedAt: null }] })
    expect((await f.call('shopManagementRename', { shopId, alias: '备注' })).ok).toBe(true)
    expect(f.host.request).toHaveBeenCalledWith('shopManagementRename', { shopId, alias: '备注' })
    for (const fields of [{ shopId, alias: 'a'.repeat(81) }, { shopId, alias: '\n' }]) expect((await f.call('shopManagementRename', fields)).ok).toBe(false)
    expect((await f.call('shopManagementPin', { shopId, pinned: 'yes' })).ok).toBe(false)
    expect((await f.call('shopManagementMove', { shopId, direction: 'left' })).ok).toBe(false)
  })
  it('binds deletion to a confirmation token and fences changes of owner', async () => {
    const f = fixture()
    expect((await f.call('shopManagementPrepareDelete', { shopId })).shopDeleteConfirmation?.confirmation).toBe(token)
    expect((await f.call('shopManagementDelete', { shopId, confirmation: 'invalid' })).ok).toBe(false)
    expect((await f.call('shopManagementDelete', { shopId, confirmation: token })).task?.kind).toBe('shop-delete')
    f.setOwner('d'.repeat(64))
    expect((await f.call('shopManagementList')).error).toBe('DOUDIAN_OWNER_CHANGED')
    expect(f.host.close).toHaveBeenCalled()
  })
  it('binds login status and identity confirmation to the originating shop task', async () => {
    const f = fixture()
    expect((await f.call('shopLoginConfirm', { taskId: token, decision: 'confirm' })).error).toBe('TASK_NOT_FOUND')
    const opened = await f.call('shopLoginStart', { shopId })
    expect(opened.shopOperation?.candidate).toEqual({ name: 'Shop A', platformId: '123' })
    expect(JSON.stringify(opened)).not.toContain('must-not-leak')
    expect((await f.call('shopLoginConfirm', { taskId: token, decision: 'confirm' })).ok).toBe(true)
    expect((await f.call('shopOperationStatus', { taskId: 'f'.repeat(32) })).error).toBe('TASK_NOT_FOUND')
    expect((await f.call('shopLoginConfirm', { taskId: token, decision: 'other' })).error).toBe('DOUDIAN_INVALID_REQUEST')
  })
  it('rejects operations after session invalidation before contacting the host', async () => {
    const f = fixture()
    expect((await f.call('shopLoginStart', { shopId })).ok).toBe(true)
    const count = f.host.request.mock.calls.length
    f.setCurrent(false)
    expect((await f.call('shopOperationStatus', { taskId: token })).error).toBe('DOUDIAN_OWNER_CHANGED')
    expect(f.host.request.mock.calls).toHaveLength(count)
  })
  it('can cancel only the bound login task during an enterprise network outage', async () => {
    const f = fixture()
    expect((await f.call('shopLoginStart', { shopId })).ok).toBe(true)
    f.setOnline(false)
    expect((await f.call('shopOperationCancel', { taskId: 'f'.repeat(32) })).error).toBe('TASK_NOT_FOUND')
    expect((await f.call('shopOperationCancel', { taskId: token })).ok).toBe(true)
  })
})
