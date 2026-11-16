import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { DoudianReply, DoudianRequest } from '../../electron/doudian-types'

import { DoudianShopManagement } from './doudian-shop-management'
import type { EnterpriseClientRuntime } from './runtime'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh' }) }))
const id = 'a'.repeat(32)

it('manages the embedded list and requires explicit confirmation before deleting', async () => {
  const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (request.action === 'shopManagementList') return { ok: true, managedShops: [{ id, name: '测试店铺', alias: null, pinned: false, sortOrder: 0, pendingLogin: false, pendingDeletion: false, status: '已登录', verifiedName: null, platformId: null, feigeStatus: null, checkedAt: null, feigeCheckedAt: null }] }
    if (request.action === 'shopManagementPrepareDelete') return { ok: true, shopDeleteConfirmation: { confirmation: 'b'.repeat(32), expiresSeconds: 120, effect: 'delete_local_profiles_and_list_keep_history' } }
    if (request.action === 'shopManagementDelete') return { ok: true, task: { taskId: 'c'.repeat(32), kind: 'shop-delete', state: 'completed', saved: 0, summary: '', error: '', messages: [] } }
    return { ok: true, shopMutation: { updated: true } }
  })
  render(<DoudianShopManagement onChanged={async () => {}} onClose={() => {}} runtime={{ doudian: send } as unknown as EnterpriseClientRuntime} />)
  fireEvent.click(await screen.findByText('测试店铺'))
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '门店一' } })
  fireEvent.click(screen.getByText('保存备注'))
  await waitFor(() => expect(send).toHaveBeenCalledWith({ action: 'shopManagementRename', shopId: id, alias: '门店一' }))
  await waitFor(() => expect((screen.getByText('删除店铺') as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByText('删除店铺'))
  expect(send.mock.calls.some(([r]) => r.action === 'shopManagementPrepareDelete')).toBe(false)
  expect(screen.getByText(/将删除本机店铺记录/)).toBeTruthy()
  fireEvent.click(screen.getByText('确认删除'))
  await waitFor(() => expect(send).toHaveBeenCalledWith({ action: 'shopManagementDelete', shopId: id, confirmation: 'b'.repeat(32) }))
  expect(send.mock.calls.some(([r]) => r.action === 'manageShops')).toBe(false)
  expect((screen.getByRole('button', { name: '店铺与客服' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: '新增店铺并登录' })).toBeNull()
  expect(send.mock.calls.some(([r]) => r.action === 'shopManagementAdd')).toBe(false)
})

it('requires explicit shop identity confirmation before completing login', async () => {
  const task = { taskId: 'c'.repeat(32), shopId: id, kind: 'shop-login' as const, state: 'awaiting_confirmation' as const, phase: 'confirm_identity', candidate: { name: '识别店铺', platformId: '123' }, bound: { name: '原店铺', platformId: '456' }, merchantStatus: null, feigeStatus: null, bindingSaved: false, error: null }
  const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (request.action === 'shopManagementList') return { ok: true, managedShops: [{ id, name: '测试店铺', alias: null, pinned: false, sortOrder: 0, pendingLogin: false, pendingDeletion: false, status: '已登录', verifiedName: null, platformId: null, feigeStatus: null, checkedAt: null, feigeCheckedAt: null }] }
    if (request.action === 'shopLoginStart') return { ok: true, shopOperation: task }
    if (request.action === 'shopLoginConfirm') return { ok: true, shopOperation: { ...task, state: 'running', phase: 'feige', bindingSaved: true } }
    if (request.action === 'shopLoginFinishFeige') return { ok: true, shopOperation: { ...task, state: 'completed', phase: 'done', bindingSaved: true } }
    return { ok: false, error: 'unexpected' }
  })
  const view = render(<DoudianShopManagement onChanged={async () => {}} onClose={() => {}} operationsSupported runtime={{ doudian: send } as unknown as EnterpriseClientRuntime} />)
  fireEvent.click(await screen.findByText('测试店铺'))
  fireEvent.click(screen.getByText('登录 / 重新登录'))
  await screen.findByText(/识别到的店铺: 识别店铺/)
  expect(screen.getByText(/原绑定: 原店铺/)).toBeTruthy()
  expect(send.mock.calls.some(([r]) => r.action === 'shopLoginConfirm')).toBe(false)
  fireEvent.click(screen.getByText('确认店铺'))
  await screen.findByText('完成飞鸽检查')
  expect(send).toHaveBeenCalledWith({ action: 'shopLoginConfirm', taskId: task.taskId, decision: 'confirm' })
  fireEvent.click(screen.getByText('完成飞鸽检查'))
  await waitFor(() => expect(send).toHaveBeenCalledWith({ action: 'shopLoginFinishFeige', taskId: task.taskId }))
  view.unmount()
  expect(send.mock.calls.some(([r]) => r.action === 'shopOperationCancel')).toBe(false)
})

it('requests cancellation if the page is left while a login is active', async () => {
  const task = { taskId: 'c'.repeat(32), shopId: id, kind: 'shop-login' as const, state: 'awaiting_confirmation' as const, phase: 'confirm_identity', candidate: { name: '识别店铺', platformId: '123' }, bound: { name: null, platformId: null }, merchantStatus: null, feigeStatus: null, bindingSaved: false, error: null }
  const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (request.action === 'shopManagementList') return { ok: true, managedShops: [{ id, name: '测试店铺', alias: null, pinned: false, sortOrder: 0, pendingLogin: false, pendingDeletion: false, status: '已登录', verifiedName: null, platformId: null, feigeStatus: null, checkedAt: null, feigeCheckedAt: null }] }
    return { ok: true, shopOperation: task }
  })
  const view = render(<DoudianShopManagement onChanged={async () => {}} onClose={() => {}} operationsSupported runtime={{ doudian: send } as unknown as EnterpriseClientRuntime} />)
  fireEvent.click(await screen.findByText('测试店铺'))
  fireEvent.click(screen.getByText('登录 / 重新登录'))
  await screen.findByText(/识别到的店铺: 识别店铺/)
  view.unmount()
  expect(send).toHaveBeenCalledWith({ action: 'shopOperationCancel', taskId: task.taskId })
})
