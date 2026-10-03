import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReceivablesReport } from './receivables-report'
import type { EnterpriseClientRuntime } from './runtime'

const report = {available:true,total:26,page:1,page_size:25,as_of_date:'2026-10-02',customers:[],followups:[],totals:[{currency:'CNY',receivable:'100.01',received:'25.01',period_received:'5.01',outstanding:'75.00',inactive:'0.00',overdue:'75.00',age_1_7:'75.00',age_8_30:'0.00',age_31_plus:'0.00'}]}
describe('authoritative receivables report', () => {
  it('uses server totals and submits combined filters, then pages on the server', async () => {
    const get = vi.fn(async (_path: string) => report)
    const api = {get, disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<ReceivablesReport runtime={api} scope="report" onInspect={vi.fn()} />)
    await screen.findByText('100.01')
    fireEvent.change(screen.getByLabelText('业务对象 / 群名称'), {target:{value:'客户群'}})
    fireEvent.change(screen.getByLabelText('人员范围'), {target:{value:'mine'}})
    fireEvent.change(screen.getByLabelText('日期口径'), {target:{value:'received_at'}})
    fireEvent.change(screen.getByLabelText('开始日期'), {target:{value:'2026-09-01'}})
    expect(get).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', {name:'查询'}))
    await screen.findByText(/所选到账期内有效收款：5.01 CNY/)
    const requested = new URL(get.mock.calls.at(-1)![0] as string, 'https://example.test')
    expect(requested.searchParams.get('owner')).toBe('mine')
    expect(requested.searchParams.get('query')).toBe('客户群')
    expect(requested.searchParams.get('from')).toBe('2026-09-01')
    fireEvent.click(screen.getByRole('button', {name:'下一页'}))
    await waitFor(() => expect(String(get.mock.calls.at(-1)?.[0])).toContain('page=2'))
  })
  it('shows a retryable error, not zero balances, if reporting fails', async () => {
    const api = {get:vi.fn().mockRejectedValue(new Error('offline')), disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<ReceivablesReport runtime={api} scope="offline" onInspect={vi.fn()} />)
    await screen.findByRole('alert')
    expect(screen.queryByText('当前条件没有记录。')).toBeNull()
    expect(screen.getByRole('button', {name:'重试'})).toBeTruthy()
  })
})
