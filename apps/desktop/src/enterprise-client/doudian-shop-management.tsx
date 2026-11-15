import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'

import type { DoudianRequest, DoudianShopOperation, ManagedDoudianShop } from '../../electron/doudian-types'
import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserProfilesPanel } from './shop-browser-profiles'

const labels = {
  zh: { title: '店铺管理', refresh: '刷新', close: '关闭', name: '店铺', status: '后台状态', remark: '备注', save: '保存备注', pin: '置顶', unpin: '取消置顶', up: '上移', down: '下移', remove: '删除店铺', cancel: '取消', confirm: '确认删除', warning: '将删除本机店铺记录及其 Chrome 和 WebView 登录资料，无法撤销。平台店铺及历史业务记录会保留。', pending: '等待登录', deleting: '删除未完成', empty: '暂无店铺', unavailable: '当前模块暂不支持内嵌店铺管理。', busy: '正在处理，请稍候', failed: '操作未完成，请刷新后重试', loginPending: '新增店铺及登录功能正在接入。' },
  en: { title: 'Shop management', refresh: 'Refresh', close: 'Close', name: 'Shop', status: 'Status', remark: 'Remark', save: 'Save remark', pin: 'Pin', unpin: 'Unpin', up: 'Move up', down: 'Move down', remove: 'Remove shop', cancel: 'Cancel', confirm: 'Confirm removal', warning: 'This permanently removes the local shop record and Chrome and WebView login profiles. The platform shop and historical records are retained.', pending: 'Login pending', deleting: 'Removal incomplete', empty: 'No shops', unavailable: 'Embedded shop management is unavailable in this module.', busy: 'Processing', failed: 'Operation failed. Refresh and try again.', loginPending: 'Adding and signing in to shops is not yet available.' }
}

export function DoudianShopManagement({ runtime, onClose, onChanged, operationsSupported = false }: {
  runtime: EnterpriseClientRuntime
  onClose: () => void
  onChanged: () => Promise<void>
  operationsSupported?: boolean
}) {
  const { locale } = useI18n()
  const copy = locale.startsWith('zh') ? labels.zh : labels.en
  const lifecycle = useMemo(() => ({ alive: true, busy: false }), [runtime])
  const [shops, setShops] = useState<ManagedDoudianShop[]>([])
  const [selected, setSelected] = useState('')
  const [alias, setAlias] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [operation, setOperation] = useState<DoudianShopOperation>()
  const operationRef = useRef<DoudianShopOperation | undefined>(undefined)
  const shop = shops.find(item => item.id === selected)
  const operationActive = !!operation && ['running', 'awaiting_confirmation', 'stopping'].includes(operation.state)

  const invoke = useCallback(async (request: Omit<DoudianRequest, 'sessionId'>) => {
    const reply = await runtime.doudian!(request)
    if (!lifecycle.alive) {
      if (reply.shopOperation && ['running', 'awaiting_confirmation', 'stopping'].includes(reply.shopOperation.state)) {
        void runtime.doudian!({ action: 'shopOperationCancel', taskId: reply.shopOperation.taskId }).catch(() => {})
      }
      return undefined
    }
    if (!reply.ok) { setError(reply.error ?? 'DOUDIAN_FAILED'); return undefined }
    if (reply.shopOperation) operationRef.current = reply.shopOperation
    return reply
  }, [lifecycle, runtime])
  const refresh = useCallback(async () => {
    const reply = await invoke({ action: 'shopManagementList' })
    if (reply?.managedShops) {
      setShops(reply.managedShops)
      setSelected(value => reply.managedShops!.some(item => item.id === value) ? value : '')
    }
  }, [invoke])
  const run = useCallback(async (operation: () => Promise<void>) => {
    if (lifecycle.busy) return
    lifecycle.busy = true
    setBusy(true)
    setError('')
    try { await operation() } catch { if (lifecycle.alive) setError('DOUDIAN_FAILED') }
    finally { lifecycle.busy = false; if (lifecycle.alive) setBusy(false) }
  }, [lifecycle])
  useEffect(() => {
    lifecycle.alive = true
    void run(refresh)
    return () => {
      lifecycle.alive = false
      const current = operationRef.current
      if (current && ['running', 'awaiting_confirmation', 'stopping'].includes(current.state)) {
        void runtime.doudian!({ action: 'shopOperationCancel', taskId: current.taskId }).catch(() => {})
      }
      operationRef.current = undefined
    }
  }, [lifecycle, refresh, run, runtime])
  useEffect(() => { setAlias(shop?.alias ?? ''); setConfirmDelete(false) }, [shop?.id, shop?.alias])
  useEffect(() => {
    if (!operationActive || !operation) return
    const timer = setInterval(() => {
      if (!lifecycle.busy) void run(async () => {
        const reply = await invoke({ action: 'shopOperationStatus', taskId: operation.taskId })
        if (reply?.shopOperation) {
          setOperation(reply.shopOperation)
          if (!['running', 'awaiting_confirmation', 'stopping'].includes(reply.shopOperation.state)) { await refresh(); await onChanged() }
        }
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [operationActive, operation?.taskId, lifecycle, run, invoke, refresh, onChanged])

  const mutate = (request: Omit<DoudianRequest, 'sessionId'>) => void run(async () => {
    if (await invoke(request)) { await refresh(); await onChanged() }
  })
  const operate = (request: Omit<DoudianRequest, 'sessionId'>) => void run(async () => {
    const reply = await invoke(request)
    if (reply?.shopOperation) {
      setOperation(reply.shopOperation)
      if (!['running', 'awaiting_confirmation', 'stopping'].includes(reply.shopOperation.state)) { await refresh(); await onChanged() }
    }
  })
  const add = () => void run(async () => {
    const reply = await invoke({ action: 'shopManagementAdd' })
    if (!reply?.shopMutation?.id) return
    const id = reply.shopMutation.id
    await refresh()
    setSelected(id)
    const started = await invoke({ action: 'shopLoginStart', shopId: id })
    if (started?.shopOperation) setOperation(started.shopOperation)
  })
  const remove = () => void run(async () => {
    if (!shop || !confirmDelete) return
    const prepared = await invoke({ action: 'shopManagementPrepareDelete', shopId: shop.id })
    const token = prepared?.shopDeleteConfirmation
    if (!token || token.effect !== 'delete_local_profiles_and_list_keep_history') return
    const result = await invoke({ action: 'shopManagementDelete', shopId: shop.id, confirmation: token.confirmation })
    if (!result?.task) return
    setConfirmDelete(false)
    let task = result.task
    while (lifecycle.alive && ['running', 'preparing', 'stopping'].includes(task.state)) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (!lifecycle.alive) return
      const status = await invoke({ action: 'status' })
      if (!status?.task) return
      task = status.task
    }
    if (task.state !== 'completed') setError('SHOP_DELETE_FAILED_REFRESH_AND_RETRY')
    await refresh()
    await onChanged()
  })

  return <section aria-label={copy.title} className="space-y-3 border-t border-(--ui-stroke-tertiary) pt-4">
    {runtime.shopBrowser ? <ShopBrowserProfilesPanel runtime={runtime} /> : null}
    <div className="flex flex-wrap items-center gap-2"><h2>{copy.title}</h2>
      <Button disabled={busy} onClick={() => void run(refresh)} variant="secondary">{copy.refresh}</Button>
      <Button disabled={busy || operationActive} onClick={onClose} variant="secondary">{copy.close}</Button>
      {busy ? <span role="status">{copy.busy}</span> : null}
    </div>
    {operationsSupported ? <Button disabled={busy || operationActive} onClick={add} variant="secondary">{locale.startsWith('zh') ? '新增店铺并登录' : 'Add and sign in'}</Button> : <p role="status">{copy.loginPending}</p>}
    {error ? <p role="alert">{copy.failed} ({error})</p> : null}
    {shops.length === 0 ? <p>{copy.empty}</p> : <table className="w-full text-left"><thead><tr><th>{copy.name}</th><th>{copy.status}</th></tr></thead><tbody>
      {shops.map(item => <tr key={item.id}><td><button aria-pressed={selected === item.id} disabled={operationActive} onClick={() => setSelected(item.id)} type="button">{item.pinned ? '★ ' : ''}{item.alias || item.name}</button>{item.verifiedName ? <span> ({item.verifiedName} {item.platformId})</span> : null}</td><td>{item.pendingDeletion ? copy.deleting : item.pendingLogin ? copy.pending : item.status ?? ''} {item.checkedAt ?? ''} / {item.feigeStatus ?? ''} {item.feigeCheckedAt ?? ''}</td></tr>)}
    </tbody></table>}
    {shop ? <div className="space-y-2">
      <label>{copy.remark}<Input disabled={busy || operationActive || shop.pendingDeletion} maxLength={80} onChange={event => setAlias(event.target.value)} value={alias} /></label>
      <div className="flex flex-wrap gap-2">
        {operationsSupported ? <><Button disabled={busy || operationActive || shop.pendingDeletion} onClick={() => operate({ action: 'shopLoginStart', shopId: shop.id })} variant="secondary">{locale.startsWith('zh') ? '登录 / 重新登录' : 'Sign in'}</Button><Button disabled={busy || operationActive || shop.pendingDeletion} onClick={() => operate({ action: 'shopCheckStart', shopId: shop.id })} variant="secondary">{locale.startsWith('zh') ? '检测登录' : 'Check login'}</Button></> : null}
        <Button disabled={busy || operationActive || shop.pendingDeletion} onClick={() => mutate({ action: 'shopManagementRename', shopId: shop.id, alias })} variant="secondary">{copy.save}</Button>
        <Button disabled={busy || operationActive || shop.pendingDeletion} onClick={() => mutate({ action: 'shopManagementPin', shopId: shop.id, pinned: String(!shop.pinned) })} variant="secondary">{shop.pinned ? copy.unpin : copy.pin}</Button>
        <Button disabled={busy || operationActive || shop.pendingDeletion} onClick={() => mutate({ action: 'shopManagementMove', shopId: shop.id, direction: 'up' })} variant="secondary">{copy.up}</Button>
        <Button disabled={busy || operationActive || shop.pendingDeletion} onClick={() => mutate({ action: 'shopManagementMove', shopId: shop.id, direction: 'down' })} variant="secondary">{copy.down}</Button>
        <Button disabled={busy || operationActive} onClick={() => setConfirmDelete(true)} variant="secondary">{copy.remove}</Button>
      </div>
      {confirmDelete ? <div role="alert"><p>{shop.alias || shop.name}: {copy.warning}</p><Button disabled={busy} onClick={remove}>{copy.confirm}</Button><Button disabled={busy} onClick={() => setConfirmDelete(false)} variant="secondary">{copy.cancel}</Button></div> : null}
    </div> : null}
    {operation ? <div role="status"><p>{operation.state} / {operation.phase} {operation.error ?? ''}</p>
      {operation.bindingSaved ? <p>{locale.startsWith('zh') ? '后台店铺绑定已保存' : 'Shop binding saved'}</p> : null}
      {operation.state === 'awaiting_confirmation' && operation.candidate ? <div><p>{locale.startsWith('zh') ? '识别到的店铺' : 'Detected shop'}: {operation.candidate.name} ({operation.candidate.platformId})</p><p>{locale.startsWith('zh') ? '原绑定' : 'Existing binding'}: {operation.bound.name ?? '-'} ({operation.bound.platformId ?? '-'})</p><Button disabled={busy} onClick={() => operate({ action: 'shopLoginConfirm', taskId: operation.taskId, decision: 'confirm' })}>{locale.startsWith('zh') ? '确认店铺' : 'Confirm shop'}</Button><Button disabled={busy} onClick={() => operate({ action: 'shopLoginConfirm', taskId: operation.taskId, decision: 'reject' })} variant="secondary">{locale.startsWith('zh') ? '拒绝' : 'Reject'}</Button></div> : null}
      {operation.state === 'running' && operation.phase === 'feige' ? <Button disabled={busy} onClick={() => operate({ action: 'shopLoginFinishFeige', taskId: operation.taskId })} variant="secondary">{locale.startsWith('zh') ? '完成飞鸽检查' : 'Finish Feige check'}</Button> : null}
      {operationActive ? <Button disabled={busy || operation.state === 'stopping'} onClick={() => operate({ action: 'shopOperationCancel', taskId: operation.taskId })} variant="secondary">{locale.startsWith('zh') ? '取消并关闭浏览器' : 'Cancel and close browser'}</Button> : null}
    </div> : null}
  </section>
}
