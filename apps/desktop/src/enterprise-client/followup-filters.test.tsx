import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context'
import { ReceivablesPage } from './receivables-page'
import { filterFollowups, historyTime, initialFollowupFilters, isFinished } from './followup-filters'
import type { ReminderCenterTask } from './reminder-state'
import type { EnterpriseClientRuntime } from './runtime'
const row = (id:string,status:string,owner='me',updated='2026-09-20T12:00:00Z'):ReminderCenterTask => ({source_id:id,source_type:'receivable_followup',business_subject:id,task_source_label:'应收款',status,task_status:status,owner_principal_id:owner,owner_name:owner,overdue:status==='followup_due',updated_at:updated,allowed_actions:[]})
describe('receivable projections',()=>{
  it('moves a completed item to history after the scoped change event',async()=>{
    let current = row('联动验收群','followup_due')
    const runtime={get:vi.fn(async()=>({followups:[current]})),post:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<I18nProvider initialLocale="zh" configClient={null}><ReceivablesPage runtime={runtime} scope="moving" principalId="me" onInspect={()=>{}}/></I18nProvider>)
    await screen.findByText('联动验收群')
    current={...current,status:'completed',overdue:false}
    act(()=>window.dispatchEvent(new CustomEvent('hermes:followup-changed',{detail:{scope:'moving'}})))
    await waitFor(()=>expect(screen.queryByText('联动验收群')).toBeNull())
    fireEvent.click(screen.getByRole('button',{name:'历史记录（已处理）'}))
    expect(screen.getByText('联动验收群')).toBeTruthy()
    expect(runtime.post).not.toHaveBeenCalled()
  })
  it('archives only terminal states; rescheduling stays actionable',()=>{
    expect(['completed','cancelled','closed'].every(status=>isFinished(row('a',status)))).toBe(true)
    expect(isFinished(row('a','waiting_update'))).toBe(false)
  })
  it('combines normalized search, owner, and status without changing data',()=>{
    const rows=[row('ＡＢＣ群','closed','seat'),row('ABC群','completed','seat'),row('ABC群','closed')]
    const result=filterFollowups(rows,{query:' abc ',owner:'seats',status:'closed'},'me')
    expect(result).toEqual([rows[0]])
    expect(rows).toHaveLength(3)
    expect(filterFollowups(rows,{...initialFollowupFilters(),owner:'id:seat'},'me')).toHaveLength(2)
  })
  it('sorts by authoritative update time, leaving missing dates last',()=>{
    const rows=[row('older','closed','me','2026-09-19T12:00:00Z'),row('missing','closed','me',''),row('newer','completed')]
    expect(rows.sort((a,b)=>historyTime(b)-historyTime(a)).map(r=>r.source_id)).toEqual(['newer','older','missing'])
  })
  it('separates history, searches it, filters people/status, and never writes',async()=>{
    const rows=[row('待办群','waiting_update'),row('旧关闭群','closed','seat','2026-09-01T00:00:00Z'),row('新关闭群','closed','seat'),row('收款群','completed'),row('取消群','cancelled')]
    const get=vi.fn(async()=>({followups:rows})); const post=vi.fn()
    const runtime={get,post} as unknown as EnterpriseClientRuntime
    render(<I18nProvider initialLocale="zh" configClient={null}><ReceivablesPage runtime={runtime} scope="scope" principalId="me" onInspect={()=>{}}/></I18nProvider>)
    await screen.findByText('待办群')
    expect(screen.queryByText('旧关闭群')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'历史记录（已处理）'}))
    expect(screen.queryByText('待办群')).toBeNull()
    expect(screen.getByText('收款群')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('状态筛选'),{target:{value:'closed'}})
    expect(screen.queryByText('收款群')).toBeNull()
    fireEvent.change(screen.getByLabelText('人员筛选'),{target:{value:'seats'}})
    const cells=within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(cells[0].textContent).toContain('新关闭群')
    fireEvent.change(screen.getByLabelText('搜索业务对象或群名称'),{target:{value:'旧关闭'}})
    expect(screen.queryByText('新关闭群')).toBeNull()
    expect(screen.getByText('旧关闭群')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/api/business-followups')
    expect(post).not.toHaveBeenCalled()
  })
})
