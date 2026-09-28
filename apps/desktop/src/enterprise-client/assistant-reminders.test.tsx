import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantReminders } from './assistant-reminders'
import type { EnterpriseClientRuntime } from './runtime'
describe('natural language reminders', () => {
  it('plans a clear conversational request and persists it only after confirmation', async () => {
    const post=vi.fn(async (_path:string, body:{action:string})=>body.action==='prepare'?{title:'回访客户',scheduled_for:Date.now()/1000+3600,clarification:''}:{reminder_id:'r-one',state:'active'})
    const runtime={get:vi.fn(async()=>({reminders:[]})),post,disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<AssistantReminders runtime={runtime} scope="test-auto" open request="一小时后提醒我回访客户" onClose={()=>{}} />)
    await screen.findByText('AI 整理的提醒草稿')
    expect(post.mock.calls.map(call=>call[1].action)).toEqual(['prepare'])
    fireEvent.click(screen.getByRole('button', {name:'确认保存该草稿'}))
    await screen.findByText(/已创建：回访客户/)
    expect(post.mock.calls.map(call=>call[1].action)).toEqual(['prepare','create'])
    expect(post.mock.calls[1][0]).toBe('/api/assistant-reminder-action')
  })
  it('asks for missing timing and never persists an ambiguous request', async () => {
    const post=vi.fn(async()=>({title:'回访客户',scheduled_for:null,clarification:'需要几点提醒？'}))
    const runtime={get:vi.fn(async()=>({reminders:[]})),post,disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<AssistantReminders runtime={runtime} scope="test-unclear" open request="提醒我回访客户" onClose={()=>{}} />)
    await screen.findByText('需要几点提醒？')
    expect(post).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button',{name:'AI 解析并预览'})).toBeTruthy()
  })
  it('uses a calendar date picker and a separate time picker for manual scheduling', async () => {
    const runtime={get:vi.fn(async()=>({reminders:[]})),post:vi.fn(async()=>({reminder_id:'r-one',state:'active'})),disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<AssistantReminders runtime={runtime} scope="test-calendar" open request="" onClose={()=>{}} />)
    await waitFor(() => expect(runtime.get).toHaveBeenCalled())
    expect(screen.getByLabelText('个人提醒日期').getAttribute('type')).toBe('date')
    expect(screen.getByLabelText('个人提醒时间').getAttribute('type')).toBe('time')
  })

  it('closes only the overlay with Escape and keeps the inline page out of modal semantics', async () => {
    const runtime = {get: vi.fn(async () => ({reminders:[]})), post: vi.fn(), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    const onClose = vi.fn()
    const overlay = render(<AssistantReminders runtime={runtime} scope="test-escape" open request="" onClose={onClose} />)

    await screen.findByRole('dialog', {name: '智能助理定时提醒'})
    fireEvent.keyDown(window, {key: 'Escape'})
    expect(onClose).toHaveBeenCalledOnce()

    overlay.unmount()
    render(<AssistantReminders inline runtime={runtime} scope="test-inline" open request="" onClose={onClose} />)
    expect(screen.queryByRole('dialog', {name: '智能助理定时提醒'})).toBeNull()
    expect(document.querySelector('[data-inline="true"]')).not.toBeNull()
  })

  it('keeps keyboard focus in the overlay and restores its opener when closed', async () => {
    const runtime = {get: vi.fn(async () => ({reminders:[]})), post: vi.fn(), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<AssistantReminders runtime={runtime} scope="test-focus" open request="" onClose={() => {}} />)

    const dialog = await screen.findByRole('dialog', {name: '智能助理定时提醒'})
    const close = screen.getByRole('button', {name: '收起'})
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, {key: 'Tab', shiftKey: true})
    expect(dialog.contains(document.activeElement)).toBe(true)

    view.rerender(<AssistantReminders runtime={runtime} scope="test-focus" open={false} request="" onClose={() => {}} />)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('keeps an overdue reminder visible until the member completes or reschedules it', async () => {
    const post=vi.fn(async()=>({reminder_id:'overdue',state:'cancelled'}))
    const runtime={get:vi.fn(async()=>({reminders:[{reminder_id:'overdue',title:'回访客户',scheduled_for:Date.now()/1000-60,state:'active',overdue:true}]})),post,disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    render(<AssistantReminders runtime={runtime} scope="test-overdue" open request="" onClose={()=>{}} />)
    await screen.findByRole('alert')
    expect(screen.getByText('已到期，等待处理。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'完成并移除'}))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/assistant-reminder-action', {action:'cancel',reminder_id:'overdue'}))
  })

  it('renders source-backed receivable work ahead of ordinary reminders and keeps result forms unmounted until requested', async () => {
    const task = {
      source_type: 'receivable_followup' as const, source_id: 'followup-1', task_source_label: '应收款跟进',
      business_subject: '华北客户年度服务费', amount: '12800.00', currency: 'CNY',
      next_followup_at: new Date(Date.now() - 60_000).toISOString(), status: 'followup_due', task_status: 'overdue', overdue: true,
      owner_principal_id: 'seat-a', owner_name: '坐席 A', allowed_actions: ['received', 'reschedule', 'cancel', 'close'], reminder_generation: 1,
    }
    const post = vi.fn(async () => ({ ok: true, followup: task }))
    const get = vi.fn(async (path: string) => path.startsWith('/api/reminder-center') ? { tasks: [task] } : { reminders: [] })
    const runtime = { get, post, disconnect: vi.fn() } as unknown as EnterpriseClientRuntime
    render(<AssistantReminders runtime={runtime} scope="test-receivable" open request="" onClose={() => {}} />)

    await screen.findByText('华北客户年度服务费')
    expect(screen.getByText('逾期风险')).toBeTruthy()
    expect(screen.getByText('12800.00 CNY')).toBeTruthy()
    expect(screen.queryByLabelText('新的预计到账日期')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '处理结果' }))
    expect(screen.getByText('选择处理结果')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '已收款' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/business-followup-action', expect.objectContaining({ action: 'received', followup_id: 'followup-1' })))
  })
})
