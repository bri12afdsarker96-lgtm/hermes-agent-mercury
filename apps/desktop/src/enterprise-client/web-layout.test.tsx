import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WebPresentationContext } from './web-presentation'
import { WebSections } from './web-sections'
import { AssistantReminders } from './assistant-reminders'
import { beijingReminderInput, beijingReminderSeconds } from './web-reminder-time'
import type { EnterpriseClientRuntime } from './runtime'

describe('web-only layout contracts', () => {
  it('keeps panel drafts mounted and supports keyboard tab selection', () => {
    render(<WebPresentationContext.Provider value><WebSections label="sections" items={[{id:'one',label:'one',content:<input aria-label="draft" />},{id:'two',label:'two',content:<p>second panel</p>}]} /></WebPresentationContext.Provider>)
    fireEvent.change(screen.getByLabelText('draft'),{target:{value:'retained'}})
    fireEvent.keyDown(screen.getByRole('tab',{name:'one'}),{key:'ArrowRight'})
    expect(screen.getByRole('tab',{name:'two'}).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('draft').closest('[role=tabpanel]')?.hasAttribute('hidden')).toBe(true)
    fireEvent.click(screen.getByRole('tab',{name:'one'}))
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('retained')
  })
  it('converts Beijing controls using an explicit offset regardless of device timezone', () => {
    for (const timezone of ['UTC','America/Los_Angeles','Asia/Tokyo']) {
      const old = process.env.TZ
      try {
        process.env.TZ = timezone
        expect(beijingReminderInput(Date.parse('2026-10-03T01:00:00Z')/1000)).toBe('2026-10-03T09:00')
        expect(beijingReminderSeconds('2026-10-03T09:00')).toBe(Date.parse('2026-10-03T01:00:00Z')/1000)
      } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ=old }
    }
    expect(Number.isNaN(beijingReminderSeconds(''))).toBe(true)
  })
  it('shows one personal task, preserves creation drafts across sections, and posts Beijing time',async()=>{
    const task={source_type:'assistant_personal',source_id:'one',business_subject:'Only task',task_source_label:'个人提醒',status:'active',task_status:'pending_followup',owner_name:'Me',allowed_actions:['complete','reschedule','cancel'],next_followup_at:'2099-10-03T01:00:00Z'}
    const post=vi.fn(async()=>({}))
    const runtime={get:vi.fn(async(path:string)=>path.startsWith('/api/reminder-center')?{tasks:[task]}:{reminders:[{reminder_id:'one',title:'Only task',state:'active',scheduled_for:Date.parse('2099-10-03T01:00:00Z')/1000}]}),post,disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<WebPresentationContext.Provider value><AssistantReminders inline open request="" scope="web-layout" runtime={runtime} onClose={()=>{}} onInspect={()=>{}} /></WebPresentationContext.Provider>)
    await screen.findByText('Only task')
    expect(screen.getAllByText('Only task')).toHaveLength(1)
    expect(screen.queryByRole('button',{name:'完成并移除'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'New reminder'}))
    fireEvent.click(screen.getByRole('button',{name:'Manual entry'}))
    fireEvent.change(screen.getByLabelText('个人提醒事项'),{target:{value:'future task'}})
    fireEvent.change(screen.getByLabelText('个人提醒日期'),{target:{value:'2099-10-03'}})
    fireEvent.change(screen.getByLabelText('个人提醒时间'),{target:{value:'09:00'}})
    fireEvent.click(screen.getByRole('button',{name:'Pending tasks'}))
    fireEvent.click(screen.getByRole('button',{name:'New reminder'}))
    expect((screen.getByLabelText('个人提醒事项') as HTMLInputElement).value).toBe('future task')
    fireEvent.click(screen.getByRole('button',{name:'确认创建提醒'}))
    await waitFor(()=>expect(post).toHaveBeenCalledWith('/api/assistant-reminder-action',expect.objectContaining({action:'create',scheduled_for:Date.parse('2099-10-03T01:00:00Z')/1000})))
  })
})
