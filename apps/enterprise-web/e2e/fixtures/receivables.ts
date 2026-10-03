import {expect, type Page} from '@playwright/test'
export async function receivablesFixture(page: Page) {
  const requests: URL[] = []
  const scope_options = {current_principal_id: 'admin', groups: [{group_id: 'g1', name: '一组'}, {group_id: 'g11', name: '十一组'}], people: [
    {principal_id: 'admin', name: '管理员', group_id: null, role: 'tenant_admin', active: true},
    {principal_id: 'seat1', name: '坐席甲', group_id: 'g1', role: 'operator', active: true},
    {principal_id: 'seat11', name: '坐席乙', group_id: 'g11', role: 'operator', active: true}
  ]}
  const seed = {
    source_type: 'receivable_followup',
    task_source_label: '应收款跟进',
    business_team: '一组',
    group_id: 'g1',
    owner_principal_id: 'seat1',
    owner_name: '坐席甲',
    status: 'open',
    task_status: 'pending_followup',
    amount: '100.00',
    currency: 'CNY',
    overdue: false,
    allowed_actions: ['cancel', 'close', 'received'],
    updated_at: '2026-10-02T01:00:00Z',
    expected_receive_date: '2026-10-02',
    received_amount: '0.00',
    remaining_amount: '100.00'
  }
  const rows = [
    {
      ...seed,
      source_id: 'today',
      business_subject: '今日测试群',
      received_amount: '20.00',
      remaining_amount: '80.00'
    },
    {
      ...seed,
      source_id: 'overdue',
      business_subject: '逾期测试群',
      overdue: true,
      expected_receive_date: '2026-10-01'
    },
    { ...seed, source_id: 'tomorrow', business_subject: '明日测试群', expected_receive_date: '2026-10-03', group_id: 'g11', owner_principal_id: 'seat11', owner_name: '坐席乙' },
    { ...seed, source_id: 'closed', business_subject: '历史测试群', status: 'closed', allowed_actions: [] },
    {
      ...seed,
      source_id: 'paid',
      business_subject: '收清测试群',
      status: 'completed',
      received_amount: '100.00',
      remaining_amount: '0.00',
      allowed_actions: []
    }
  ]
  let personalState = 'active'
  const personal = {
    ...seed,
    owner_principal_id: 'admin',
    owner_name: '管理员',
    group_id: null,
    source_type: 'assistant_personal',
    source_id: 'personal',
    reminder_id: 'personal',
    task_source_label: '个人提醒',
    business_subject: '个人测试提醒',
    status: 'active',
    overdue: true,
    allowed_actions: ['reschedule', 'cancel'],
    next_followup_at: '2026-10-01T09:00:00+08:00'
  }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    requests.push(url)
    let body: unknown = {
      available: false,
      tasks: [],
      reminders: [],
      groups: [],
      members: [],
      requests: [],
      entries: []
    }
    const totals = {
      currency: 'CNY',
      due_today: '80.00',
      unpaid: '380.00',
      outstanding: '280.00',
      inactive: '100.00',
      received: '120.00',
      receivable: '500.00',
      overdue: '100.00',
      age_1_7: '100.00',
      age_8_30: '0.00',
      age_31_plus: '0.00'
    }
    switch (url.pathname) {
      case '/api/whoami':
        body = {
          principal_id: 'admin',
          tenant_id: 'tenant',
          name: '管理员',
          tenant_name: '测试企业',
          role: 'tenant_admin',
          effective_permissions: ['*'],
          product_capabilities: {},
          desktop_surfaces: { schema_version: 1, surfaces: { workflows: { available: true } } }
        }
        break
      case '/api/health':
        body = { ok: true, auth_mode: 'strict' }
        break
      case '/api/metrics':
        body = { alerts: [] }
        break
      case '/api/operations-overview':
        body = { groups: [], knowledge: {}, scope: {}, staff: [], summary: {}, reminders: [] }
        break
      case '/api/reminder-center':
        body = { available: true, tasks: [...rows, personal] }
        break
      case '/api/assistant-reminders':
        body = {
          reminders: [
            { reminder_id: 'personal', title: '个人测试提醒', scheduled_for: 1790816400, state: personalState,
              allowed_actions: personalState === 'active' ? ['complete','reschedule','cancel'] : [] }
          ]
        }
        break
      case '/api/assistant-reminder-action':
        personalState = 'cancelled'
        body = { reminder_id: 'personal', state: personalState, resolution: 'completed' }
        break
      case '/api/business-followups':
        body = url.searchParams.has('followup_id')
          ? { followup: rows.find(row => row.source_id === url.searchParams.get('followup_id')) }
          : { available: true, followups: rows, scope_options }
        break
      case '/api/business-followup-history':
        body = {
          available: true,
          can_record_receipt: false,
          can_correct_receipt: false,
          can_add_note: false,
          transfer_targets: [],
          received_amount: '0.00',
          remaining_amount: '100.00',
          receipts: [],
          history: []
        }
        break
      case '/api/receivables-report': {
        const bucket = url.searchParams.get('bucket') || 'all'
        const predicates: Record<string, (row: (typeof rows)[number]) => boolean> = {
          all: () => true,
          due_today: row => row.source_id === 'today',
          unpaid: row => row.remaining_amount !== '0.00',
          outstanding: row => row.status === 'open',
          inactive: row => row.status === 'closed',
          received: row => row.received_amount !== '0.00',
          overdue: row => row.overdue,
          age_1_7: row => row.overdue
        }
        const baseRows = rows.filter(row => (!url.searchParams.get('group_id') || row.group_id === url.searchParams.get('group_id')) &&
          (!url.searchParams.get('owner')?.startsWith('id:') || `id:${row.owner_principal_id}` === url.searchParams.get('owner')) &&
          (!url.searchParams.get('status') || url.searchParams.get('status') === 'all' || row.status === url.searchParams.get('status')))
        const selected = baseRows.filter(
          row =>
            (predicates[bucket]?.(row) ?? false) &&
            (!url.searchParams.get('due_date') ||
              (row.status === 'open' && row.expected_receive_date === url.searchParams.get('due_date'))) &&
            (!url.searchParams.get('query') || row.business_subject.includes(url.searchParams.get('query')!)) &&
            (url.searchParams.get('detail_view') !== 'current' || row.status === 'open') &&
            (url.searchParams.get('detail_view') !== 'history' || row.status !== 'open')
        )
        body = {
          available: true,
          scope_options,
          total: selected.length,
          page: 1,
          page_size: 25,
          as_of_date: '2026-10-02',
          summary_totals: [{...totals, unpaid: baseRows.reduce((sum, row) => sum + Number(row.remaining_amount), 0).toFixed(2)}],
          daily_from: '2026-10-02',
          daily_to: '2026-10-03',
          daily: [
            { date: '2026-10-02', amount: '80.00', count: 1, currency: 'CNY' },
            { date: '2026-10-03', amount: '100.00', count: 1, currency: 'CNY' }
          ],
          followups: selected,
          customers: []
        }
        break
      }
    }
    await route.fulfill({ json: body })
  })
  await page.goto('/')
  await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
  return requests
}
