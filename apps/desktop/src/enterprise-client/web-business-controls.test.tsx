import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebPresentationContext } from './web-presentation'
import { I18nProvider } from '@/i18n/context'
import { FollowupFilterBar, filterFollowups } from './followup-filters'
import { OperationsGroupPanel } from './operations-group-panel'
import { TenantAiConfigPanel } from './tenant-ai-config-panel'
import { ReceivableLedger } from './receivable-ledger'
import type { EnterpriseClientRuntime } from './runtime'
import type { ReactNode } from 'react'
import type { ReminderCenterTask } from './reminder-state'

const wrap = (child: ReactNode) => <I18nProvider initialLocale="zh"><WebPresentationContext.Provider value>{child}</WebPresentationContext.Provider></I18nProvider>
const ledger = {available:true,can_record_receipt:true,can_correct_receipt:false,can_add_note:true,received_amount:'0',remaining_amount:'20',receipts:[],history:[],transfer_targets:[{principal_id:'p2',name:'小林',group_id:'g2',group_name:'第二组'}]}
function api(get: ReturnType<typeof vi.fn>, post = vi.fn(async () => ({ok:true}))) {return {get,post,disconnect:vi.fn()} as unknown as EnterpriseClientRuntime}
describe('web business controls preserve dependencies and authority', () => {
  beforeEach(() => sessionStorage.clear())
  it('keeps unavailable filters explicit without silently broadening the selection', () => {
    const onChange = vi.fn()
    render(wrap(<FollowupFilterBar rows={[]} statuses={[]} value={{query:'订单',owner:'id:removed',status:'open'}} onChange={onChange}/>))
    expect(screen.getByRole('option',{name:'其他成员的'})).toBeTruthy()
    expect((screen.getByLabelText('人员筛选') as HTMLSelectElement).selectedOptions[0].text).toContain('当前无匹配事项')
    expect((screen.getByLabelText('状态筛选') as HTMLSelectElement).value).toBe('open')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'全部'}))
    expect(onChange).toHaveBeenCalledWith({query:'订单',owner:'all',status:'all'})
  })
  it('retains a failed group creation draft and makes unassigned a display-only placeholder', async () => {
    const runtime = api(vi.fn(async () => ({groups:[{group_id:'g1',name:'一组',owner_name:'主管',manager_principal_id:'m1',member_count:1}],managers:[{principal_id:'m1',name:'主管',role:'supervisor'}],operators:[{principal_id:'o1',name:'小周',group_name:'一组',group_id:'g1'}]})),vi.fn().mockRejectedValue(new Error('保存失败')))
    render(wrap(<OperationsGroupPanel runtime={runtime}/>))
    await screen.findByText('主管（主管）')
    fireEvent.change(screen.getByLabelText('新增组别名称'),{target:{value:'保留草稿'}})
    fireEvent.click(screen.getByRole('button',{name:'新增组别'}))
    await screen.findByRole('alert')
    expect((screen.getByLabelText('新增组别名称') as HTMLInputElement).value).toBe('保留草稿')
    expect((screen.getByRole('option',{name:'未分组（请选择目标组）'}) as HTMLOptionElement).disabled).toBe(true)
  })
  it('cascades teams from authorized people, not task names, and resets only the dependent owner', () => {
    const onChange = vi.fn()
    const scopeOptions = {current_principal_id:'me',groups:[{group_id:'g1',name:'一组'},{group_id:'g2',name:'二组'}],people:[{principal_id:'p1',name:'小周',group_id:'g1',role:'operator',active:true},{principal_id:'p2',name:'小林',group_id:'g2',role:'supervisor',active:true}]}
    render(wrap(<FollowupFilterBar rows={[]} scopeOptions={scopeOptions} statuses={[]} value={{query:'订单',owner:'id:p1',status:'all',group:'g1'}} onChange={onChange}/>))
    expect(screen.getByRole('option',{name:'小周'})).toBeTruthy()
    expect(screen.queryByRole('option',{name:'小林'})).toBeNull()
    fireEvent.change(screen.getByLabelText('团队筛选'),{target:{value:'g2'}})
    expect(onChange).toHaveBeenCalledWith({query:'订单',owner:'all',status:'all',group:'g2'})
    const rows = [{business_subject:'订单',owner_principal_id:'p1',group_id:'g1',status:'open'},{business_subject:'订单',owner_principal_id:'p2',group_id:'g2',status:'open'}] as ReminderCenterTask[]
    expect(filterFollowups(rows,{query:'',owner:'all',status:'all',group:'g2'},'me')).toEqual([rows[1]])
  })
  it('clears provider-specific credentials, model, URL and edit identity on switching vendor', async () => {
    const status = {configured:true,models:[{configuration_id:'c1',is_default:true,model:'old-model',provider:'old',base_url:'https://old.example'}],providers:[{key:'old',default_model:'old-model'},{key:'new',default_model:'new-model'}]}
    const runtime = api(vi.fn(async () => status))
    render(wrap(<TenantAiConfigPanel runtime={runtime} section="models"/>))
    fireEvent.click(await screen.findByRole('button',{name:'更新'}))
    fireEvent.change(screen.getByLabelText('API Key（留空则保留原密钥）'),{target:{value:'old-secret'}})
    fireEvent.change(screen.getByLabelText('AI 厂商'),{target:{value:'new'}})
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Base URL（可选）') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('模型') as HTMLInputElement).value).toBe('new-model')
    fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'new-secret'}})
    fireEvent.click(screen.getByRole('button',{name:'安全保存新模型'}))
    await waitFor(() => expect(runtime.post).toHaveBeenCalledWith('/api/tenant-ai-config',expect.objectContaining({provider:'new',api_key:'new-secret',configuration_id:undefined,base_url:undefined})))
  })
  it('revalidates transfer candidates before posting and does not send a stale person', async () => {
    const runtime = api(vi.fn().mockResolvedValueOnce(ledger).mockResolvedValue({...ledger,transfer_targets:[]}))
    render(wrap(<ReceivableLedger runtime={runtime} scope="s" followupId="f"/>))
    await screen.findByLabelText('转交目标团队')
    fireEvent.click(screen.getByText('备注与负责人转交'))
    fireEvent.change(screen.getByLabelText('转交目标团队'),{target:{value:'g2'}})
    fireEvent.change(screen.getByLabelText('转交负责人'),{target:{value:'p2'}})
    fireEvent.click(screen.getByRole('button',{name:'确认转交'}))
    await screen.findByText('该负责人已不在当前授权候选中，请重新选择。')
    expect(runtime.post).not.toHaveBeenCalled()
  })
  it('refreshes from the task refresh key and trusts history receipt capability without reopening status', async () => {
    const runtime = api(vi.fn(async () => ({...ledger,status:'closed'})))
    const view = render(wrap(<ReceivableLedger runtime={runtime} scope="s" followupId="f" refreshKey={0} hideRefresh/>))
    await screen.findByLabelText('本次收款金额')
    expect(screen.queryByRole('button',{name:'刷新流水'})).toBeNull()
    view.rerender(wrap(<ReceivableLedger runtime={runtime} scope="s" followupId="f" refreshKey={1} hideRefresh/>))
    await waitFor(() => expect(runtime.get).toHaveBeenCalledTimes(2))
    expect(runtime.post).not.toHaveBeenCalled()
  })
})
