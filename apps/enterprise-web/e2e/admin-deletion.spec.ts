import {expect, test} from '@playwright/test'
import {receivablesFixture} from './fixtures/receivables'

for (const kind of ['assistant_personal','receivable_followup'] as const) {
  test(`administrator deletes one ${kind} with confirmation and retained history`, async ({page}) => {
    await receivablesFixture(page)
    let deleted = false
    const writes: unknown[] = []
    const title = kind === 'assistant_personal' ? '成员定时提醒删除验收' : '成员跟进删除验收'
    const row = () => ({source_id:'delete-target',followup_id:'delete-target',reminder_id:'delete-target',
      source_type:kind, business_subject:title, owner_principal_id:'seat',owner_name:'坐席甲',
      status:deleted ? 'closed' : 'open',task_status:deleted ? 'closed' : 'overdue',
      resolution:deleted ? 'admin_deleted' : undefined,amount:'100.00',currency:'CNY',
      remaining_amount:'100.00',received_amount:'0.00',overdue:!deleted,
      next_followup_at:'2026-10-01T09:00:00+08:00',allowed_actions:deleted ? [] : ['admin_delete']})
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/reminder-center') return route.fulfill({json:{available:true,tasks:deleted ? [] : [row()],
        personal_history:deleted && kind === 'assistant_personal' ? [{reminder_id:'delete-target',title,
          state:'cancelled',resolution:'admin_deleted',resolved_at:1790989200,resolved_by:'admin',owner_name:'坐席甲',scheduled_for:1790816400}] : []}})
      if (url.pathname === '/api/assistant-reminders') return route.fulfill({json:{reminders:url.searchParams.has('reminder_id') ? [{
        reminder_id:'delete-target',title,scheduled_for:1790816400,state:deleted ? 'cancelled':'active',
        resolution:deleted ? 'admin_deleted':undefined,allowed_actions:deleted ? [] : ['admin_delete']}] : []}})
      if (url.pathname === '/api/business-followups') return route.fulfill({json:{followup:row(),followups:[row()]}})
      if (url.pathname === '/api/business-followup-history') return route.fulfill({json:{available:true,
        can_record_receipt:false,can_correct_receipt:false,can_add_note:false,transfer_targets:[],
        received_amount:'0.00',remaining_amount:'100.00',receipts:[],history:deleted ? [{history_id:'audit',event_type:'closed',
          actor_principal_id:'admin',created_at:'2026-10-03T01:00:00Z',facts_delta:{resolution:'admin_deleted'}}] : []}})
      if (['/api/assistant-reminder-action','/api/business-followup-action'].includes(url.pathname)) {
        const body = route.request().postDataJSON(); writes.push(body)
        expect(body.action).toBe('admin_delete')
        expect(body.followup_id ?? body.reminder_id).toBe('delete-target')
        deleted = true
        return route.fulfill({json:kind === 'assistant_personal' ? {reminder_id:'delete-target',state:'cancelled',resolution:'admin_deleted'} : {ok:true,followup:row()}})
      }
      return route.fallback()
    })
    await page.reload()
    const nav = page.getByRole('navigation')
    await nav.getByRole('button',{name:/逾期未处理/}).click()
    await page.getByRole('row').filter({hasText:title}).getByRole('button',{name:'查看与处理'}).click()
    const dialog = page.getByRole('dialog',{name:'当前任务详情'})
    await dialog.getByRole('button',{name:'管理员删除',exact:true}).click()
    expect(writes).toHaveLength(0)
    await expect(dialog.getByText(/不删除业务事实或收款流水/)).toBeVisible()
    await dialog.getByRole('button',{name:'返回详情'}).click()
    expect(writes).toHaveLength(0)
    await dialog.getByRole('button',{name:'管理员删除',exact:true}).click()
    await dialog.getByRole('button',{name:'确认操作'}).click()
    await expect(dialog.getByText('当前任务已更新。')).toBeVisible()
    expect(writes).toHaveLength(1)
    await expect(dialog.getByRole('button',{name:'管理员删除',exact:true})).toHaveCount(0)
    if (kind === 'receivable_followup') {
      await dialog.getByText('操作历史',{exact:true}).click()
      await expect(dialog.locator('li').filter({hasText:'管理员删除'})).toContainText('admin')
      await expect(dialog.getByText('100.00',{exact:false}).first()).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('row').filter({hasText:title})).toHaveCount(0)
    if (kind === 'assistant_personal') {
      await nav.getByRole('button',{name:'提醒中心',exact:true}).click()
      await page.getByRole('button',{name:'处理历史',exact:true}).click()
      const history = page.locator('.hesc-outbound-item').filter({hasText:title})
      await expect(history).toContainText('管理员删除')
      await expect(history).toContainText('操作人：admin')
      await expect(history).toContainText('所属成员：坐席甲')
    }
  })
}
