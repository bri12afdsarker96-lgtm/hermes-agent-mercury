import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceivableLedger } from './receivable-ledger'
import type { EnterpriseClientRuntime } from './runtime'
import { enterpriseClientErrorForStatus } from './runtime-errors'

const ledger = {available:true, can_record_receipt:true, can_correct_receipt:true, can_add_note:true, transfer_targets:[{principal_id:'member', name:'新负责人'}], received_amount:'20.00', remaining_amount:'80.00', receipts:[], history:[]}
function runtime(post = vi.fn(async () => ({ok:true}))) {
  return {get:vi.fn(async () => ledger), post, disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
}
function fillReceipt() {
  fireEvent.change(screen.getByLabelText('本次收款金额'), {target:{value:'12.34'}})
  fireEvent.change(screen.getByLabelText('实际到账时间'), {target:{value:'2026-01-01T10:00'}})
  fireEvent.click(screen.getByRole('button', {name:'确认登记收款'}))
}
describe('receivable ledger operations', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear() })
  it('recovers a lost response after remount with exactly the same receipt and key', async () => {
    const post = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ok:true})
    const api = runtime(post)
    const view = render(<ReceivableLedger runtime={api} scope="server:tenant:owner" followupId="f1" />)
    await screen.findByLabelText('本次收款金额')
    fillReceipt()
    await screen.findByRole('button', {name:'重试原提交'})
    const original = post.mock.calls[0][1]
    view.unmount()
    render(<ReceivableLedger runtime={api} scope="server:tenant:owner" followupId="f1" />)
    fireEvent.click(await screen.findByRole('button', {name:'重试原提交'}))
    await screen.findByText('已保存到服务端。')
    expect(post.mock.calls[1]).toEqual(['/api/receivable-receipt-action', original])
    expect(sessionStorage.length).toBe(0)
  })
  it('allows editing a definitively rejected receipt without retaining a pending retry', async () => {
    const api = runtime(vi.fn().mockRejectedValue(enterpriseClientErrorForStatus(409)))
    render(<ReceivableLedger runtime={api} scope="reject" followupId="f1" />)
    await screen.findByLabelText('本次收款金额'); fillReceipt()
    await screen.findByText(/服务端拒绝了此次提交/)
    expect(screen.queryByRole('button', {name:'重试原提交'})).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
  it('sends a note and authorized handover to the management endpoint, never as a receipt', async () => {
    const api = runtime()
    render(<ReceivableLedger runtime={api} scope="manage" followupId="f1" />)
    fireEvent.change(await screen.findByLabelText('跟进备注'), {target:{value:'已电话跟进'}})
    fireEvent.click(screen.getByRole('button', {name:'保存跟进备注'}))
    await screen.findByText('已保存到服务端。')
    expect(api.post).toHaveBeenCalledWith('/api/business-followup-manage', expect.objectContaining({action:'note',note:'已电话跟进'}))
    fireEvent.change(screen.getByLabelText('转交负责人'), {target:{value:'member'}})
    fireEvent.click(screen.getByRole('button', {name:'确认转交'}))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/business-followup-manage', expect.objectContaining({action:'transfer',target_principal_id:'member'})))
  })
  it('does not display write controls without server permission', async () => {
    const api = {...runtime(), get:vi.fn(async () => ({...ledger,can_record_receipt:false,can_correct_receipt:false,can_add_note:false,transfer_targets:[]}))} as unknown as EnterpriseClientRuntime
    render(<ReceivableLedger runtime={api} scope="reader" followupId="f1" />)
    await screen.findByText(/已确认收款：20.00/)
    expect(screen.queryByLabelText('本次收款金额')).toBeNull()
    expect(screen.queryByLabelText('跟进备注')).toBeNull()
    expect(screen.queryByLabelText('转交负责人')).toBeNull()
  })
})
