import {expect, test, type Page} from '@playwright/test'
import {receivablesFixture} from './fixtures/receivables'

type Entry = 'receivables' | 'overdue' | 'pending' | 'history'
type Scenario = 'owner-open' | 'owner-pending' | 'manager-other' | 'owner-history'

// This tests the rendered web action contract, not production authorization.
// Backend PostgreSQL tests separately establish which actions an actor may receive.
async function actionFixture(page: Page, initial: Scenario) {
  await receivablesFixture(page)
  let scenario = initial
  const detailReads: string[] = []
  const writes: string[] = []
  const scope_options = {
    current_principal_id:'admin', groups:[{group_id:'g1',name:'一组'}],
    people:[{principal_id:'admin',name:'管理员',group_id:null,role:'tenant_admin',active:true},
      {principal_id:'seat1',name:'坐席甲',group_id:'g1',role:'operator',active:true}]
  }
  const row = () => ({
    source_id:'action-contract',followup_id:'action-contract',source_type:'receivable_followup',
    task_source_label:'应收款跟进',business_subject:'操作矩阵同一笔应收',business_team:'一组',group_id:scenario === 'manager-other' ? 'g1' : null,
    owner_principal_id:scenario === 'manager-other' ? 'seat1' : 'admin',
    owner_name:scenario === 'manager-other' ? '坐席甲' : '管理员',
    status:scenario === 'owner-history' ? 'closed' : scenario === 'owner-pending' ? 'pending_confirmation' : 'open',
    task_status:scenario === 'owner-history' ? 'closed' : 'pending_followup',
    amount:'100.00',currency:'CNY',received_amount:'20.00',remaining_amount:'80.00',
    overdue:!['owner-history','owner-pending'].includes(scenario),expected_receive_date:'2026-10-01',
    next_followup_at:scenario === 'owner-pending' ? null : '2026-10-01T09:00:00+08:00',updated_at:'2026-10-02T01:00:00Z',
    allowed_actions:scenario === 'owner-open' ? ['received','reschedule','cancel','close']
      : scenario === 'owner-pending' ? ['confirm','cancel','close'] : []
  })
  // A list can be older than the selected detail. Never authorize writes from that snapshot.
  const listRow = () => scenario === 'owner-pending' ? {...row(),status:'open',overdue:true,next_followup_at:'2026-10-01T09:00:00+08:00',allowed_actions:['received','reschedule','cancel','close']} : row()
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() !== 'GET') {
      writes.push(url.pathname)
      return route.fulfill({status:400,json:{error:'This read-only action coverage fixture does not accept mutations'}})
    }
    if (url.pathname === '/api/reminder-center') {
      return route.fulfill({json:{available:true,scope_options,tasks:scenario === 'owner-history' ? [] : [listRow()]}})
    }
    if (url.pathname === '/api/assistant-reminders') return route.fulfill({json:{reminders:[]}})
    if (url.pathname === '/api/business-followups' && url.searchParams.has('followup_id')) {
      const id = url.searchParams.get('followup_id')!
      detailReads.push(id)
      return route.fulfill({json:{followup:id === 'action-contract' ? row() : null}})
    }
    if (url.pathname === '/api/business-followup-history') {
      detailReads.push(`ledger:${url.searchParams.get('followup_id')}`)
      return route.fulfill({json:{available:true,
        can_record_receipt:['owner-open','owner-history'].includes(scenario),
        can_correct_receipt:scenario !== 'manager-other',can_add_note:scenario !== 'manager-other',
        transfer_targets:scenario === 'manager-other' ? [{principal_id:'admin',name:'管理员',group_id:null,group_name:'未分组',role:'tenant_admin'}] : [],
        received_amount:'20.00',remaining_amount:'80.00',receipts:[],history:[]}})
    }
    if (url.pathname === '/api/receivables-report') {
      const history = scenario === 'owner-history'
      const view = url.searchParams.get('detail_view')
      const visible = view !== 'current' || !history
      const selected = visible && (view !== 'history' || history) ? [listRow()] : []
      return route.fulfill({json:{available:true,scope_options,followups:selected,total:selected.length,page:1,page_size:25,
        as_of_date:'2026-10-02',daily_from:'2026-10-02',daily_to:'2026-10-03',daily:[],customers:[],
        summary_totals:[{currency:'CNY',receivable:'100.00',received:'20.00',unpaid:'80.00',
          due_today:'0.00',outstanding:history ? '0.00' : '80.00',inactive:history ? '80.00' : '0.00',
          overdue:history ? '0.00' : '80.00',age_1_7:history ? '0.00' : '80.00',age_8_30:'0.00',age_31_plus:'0.00'}]}})
    }
    return route.fallback()
  })
  await page.reload()
  await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
  return {detailReads,writes,setScenario:(value:Scenario) => {scenario = value}}
}

async function inspectFrom(page: Page, entry: Entry) {
  const nav = page.getByRole('navigation',{name:'企业客户端主导航'})
  if (entry === 'overdue') {
    await nav.getByRole('button',{name:/逾期未处理/}).click()
    await page.getByRole('row').filter({hasText:'操作矩阵同一笔应收'}).getByRole('button',{name:'查看与处理'}).click()
  } else if (entry === 'pending') {
    await nav.getByRole('button',{name:/运营总览/}).click()
    await page.getByTestId('enterprise-client-workbench').locator('.hesc-kpis').getByRole('button',{name:/待跟进事项/}).click()
    const inbox = page.getByRole('region',{name:'统一任务收件箱'})
    await inbox.getByRole('button',{name:'待跟进',exact:true}).click()
    await inbox.locator('article').filter({hasText:'操作矩阵同一笔应收'}).getByRole('button',{name:'查看详情'}).click()
  } else {
    await nav.getByRole('button',{name:/应收款跟进/}).click()
    const report = page.getByRole('region',{name:'收款统计与客户台账'})
    await report.getByRole('button',{name:entry === 'history' ? '历史记录' : '当前跟进',exact:true}).click()
    await report.getByRole('region',{name:'对应任务明细'}).getByRole('row').filter({hasText:'操作矩阵同一笔应收'}).getByRole('button',{name:'查看与处理'}).click()
  }
  const dialog = page.getByRole('dialog',{name:'当前任务详情'})
  await expect(dialog.getByRole('heading',{name:'操作矩阵同一笔应收',exact:true})).toBeVisible()
  await expect(dialog.getByText('统一任务收件箱',{exact:true})).toHaveCount(0)
  await expect(dialog.getByText('今日测试群',{exact:true})).toHaveCount(0)
  return dialog
}

test('the same receivable uses fresh task capabilities from receivables, overdue, pending and history entries', async ({page}) => {
  const fixture = await actionFixture(page,'owner-open')
  for (const entry of ['receivables','overdue','pending'] as const) {
    const before = fixture.detailReads.length
    const dialog = await inspectFrom(page,entry)
    await expect(dialog.getByRole('button',{name:'确认全部收款',exact:true})).toBeEnabled()
    await expect(dialog.getByRole('button',{name:'改期跟进',exact:true})).toBeEnabled()
    await expect(dialog.getByRole('button',{name:'确认登记收款',exact:true})).toBeVisible()
    expect(fixture.detailReads.slice(before)).toContain('action-contract')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
  fixture.setScenario('owner-history')
  await page.reload()
  const dialog = await inspectFrom(page,'history')
  await expect(dialog.getByRole('button',{name:'确认全部收款',exact:true})).toHaveCount(0)
  await expect(dialog.getByRole('button',{name:'改期跟进',exact:true})).toHaveCount(0)
  // Closed is not paid: the server may permit recording a real late receipt.
  await expect(dialog.getByRole('button',{name:'确认登记收款',exact:true})).toBeVisible()
  expect(fixture.detailReads.filter(id => id === 'action-contract').length).toBeGreaterThanOrEqual(4)
  expect(fixture.writes).toEqual([])
})

for (const entry of ['receivables','overdue','pending'] as const) {
  test(`${entry}: pending confirmation exposes establishing follow-up, never receiving money`, async ({page}) => {
    const fixture = await actionFixture(page,'owner-pending')
    const dialog = await inspectFrom(page,entry)
    await expect(dialog.getByRole('button',{name:'确认建立跟进',exact:true})).toBeEnabled()
    await expect(dialog.getByRole('button',{name:'确认全部收款',exact:true})).toHaveCount(0)
    await expect(dialog.getByRole('button',{name:'确认登记收款',exact:true})).toHaveCount(0)
    await expect(dialog.getByRole('button',{name:'改期跟进',exact:true})).toHaveCount(0)
    await dialog.getByRole('button',{name:'确认建立跟进',exact:true}).click()
    await expect(dialog.getByRole('region',{name:'确认任务操作'})).toContainText('不代表')
    expect(fixture.detailReads).toContain('action-contract')
    expect(fixture.writes).toEqual([])
  })
  test(`${entry}: managing another owner exposes authorized transfer without financial mutation rights`, async ({page}) => {
    const fixture = await actionFixture(page,'manager-other')
    const dialog = await inspectFrom(page,entry)
    await expect(dialog.getByRole('button',{name:'确认全部收款',exact:true})).toHaveCount(0)
    await expect(dialog.getByRole('button',{name:'改期跟进',exact:true})).toHaveCount(0)
    await expect(dialog.getByLabel('本次收款金额',{exact:true})).toHaveCount(0)
    await expect(dialog.getByText(/当前为管理查看/)).toBeVisible()
    await dialog.getByText('备注与负责人转交',{exact:true}).click()
    await dialog.getByRole('combobox',{name:'转交目标团队'}).selectOption('__ungrouped__')
    await dialog.getByRole('combobox',{name:'转交负责人',exact:true}).selectOption('admin')
    await expect(dialog.getByRole('button',{name:'确认转交',exact:true})).toBeEnabled()
    expect(fixture.detailReads).toContain('action-contract')
    expect(fixture.writes).toEqual([])
  })
}
