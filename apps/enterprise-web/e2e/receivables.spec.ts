import { expect, test } from '@playwright/test'

// Exercises the shipped browser bridge and renderer. API facts are isolated
// fixtures; actual PostgreSQL/SQLite mutations have separate server E2E tests.
test('web build retains 0.20.7 workflows and exposes the receipt iteration', async ({page}, info) => {
  const errors: string[] = []
  const writes: {path:string; body:Record<string,unknown>}[] = []
  page.on('pageerror', error => errors.push(error.message))
  const row = {source_id:'fixture-receivable',followup_id:'fixture-receivable',source_type:'receivable_followup',task_source_label:'应收款跟进',business_subject:'网页验收群',business_team:'测试团队',owner_principal_id:'fixture-admin',owner_name:'验收管理员',status:'open',task_status:'pending_followup',amount:'100.00',currency:'CNY',overdue:false,allowed_actions:['received','cancel','close'],next_followup_at:'2027-01-20T09:00:00+08:00',expected_receive_date:'2027-01-20',updated_at:'2026-10-02T00:00:00Z'}
  const overdue = Array.from({length:30}, (_,index) => ({...row,source_id:`due-${index}`,business_subject:`逾期验收群${index}`,owner_principal_id:'seat',status:'followup_due',overdue:true,allowed_actions:[],task_status:'overdue'}))
  let received = false
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url())
    const body = request.method() === 'POST' ? request.postDataJSON() : null
    if (body) {writes.push({path:url.pathname,body})}
    let payload: unknown
    switch (url.pathname) {
      case '/api/whoami': payload={principal_id:'fixture-admin',tenant_id:'fixture-tenant',tenant_name:'网页验收企业',name:'验收管理员',role:'tenant_admin',effective_permissions:['*'],product_capabilities:{enterprise_chat:{enabled:true,status:'LIVE'},knowledge_rag:{enabled:true,status:'LIVE'}},desktop_surfaces:{schema_version:1,surfaces:{knowledge:{available:true},workflows:{available:true}}}}; break
      case '/api/health': payload={ok:true,auth_mode:'strict'}; break
      case '/api/metrics': payload={alerts:[]}; break
      case '/api/operations-overview': payload={groups:[],knowledge:{published:338,pending_review:0},knowledge_available:true,scope:{operator_count:3,read_only:false},staff:[],summary:{},reminders:[]}; break
      case '/api/operations-reminders': case '/api/assistant-reminders': payload={reminders:[]}; break
      case '/api/reminder-center': payload={available:true,tasks:[row,...overdue]}; break
      case '/api/business-followups': payload=url.searchParams.has('followup_id')?{followup:row}:{available:true,followups:[row]}; break
      case '/api/receivables-report': payload={available:true,total:1,page:1,page_size:25,as_of_date:'2026-10-02',daily_from:'2026-10-02',daily_to:'2026-10-08',daily:[],followups:[{...row,received_amount:received?'25.00':'0.00',remaining_amount:received?'75.00':'100.00',original_expected_receive_date:'2027-01-20',overdue_days:0}],summary_totals:[{currency:'CNY',receivable:'100.00',received:received?'25.00':'0.00',unpaid:received?'75.00':'100.00',due_today:'0.00',outstanding:received?'75.00':'100.00',inactive:'0.00',overdue:'0.00',age_1_7:'0.00',age_8_30:'0.00',age_31_plus:'0.00'}],customers:[]}; break
      case '/api/business-followup-history': payload={available:true,can_add_note:true,can_record_receipt:true,can_correct_receipt:true,transfer_targets:[{principal_id:'seat',name:'验收坐席'}],received_amount:received?'25.00':'0.00',remaining_amount:received?'75.00':'100.00',receipts:received?[{event_type:'receipt_recorded',receipt_id:'receipt-fixture',amount:'25.00',received_at:'2026-01-01T10:00:00Z',recorded_at:'2026-10-02T00:00:00Z',reversed:false,note:''}]:[],history:[]}; break
      case '/api/receivable-receipt-action': received=true; payload={ok:true}; break
      case '/api/business-followup-manage': payload={ok:true}; break
      case '/api/tenant-ai-models': payload={configured:true,models:[{configuration_id:'fixture-model',is_default:true,model:'验收模型',provider:'fixture'}]}; break
      case '/api/tenant-ai-personas': payload={personas:[{persona_id:'customer-service',name:'智能客服',is_default:true}]}; break
      case '/api/tenant-ai-assist': payload={answer_text:'请提供订单资料。',reasoning_summary:'先核实信息。',customer_reply_options:[{kind:'current_reply',text:'请提供订单资料。'},{kind:'follow_up',text:'收到资料后继续跟进。'},{kind:'alternative_reply',text:'也可以提供包装照片。'}],retrieval_meta:{matched_count:2,status:'hit',candidate_count:6,best_similarity:0.8,similarity_threshold:0.5}}; break
      default: payload={available:false,configured:false,entries:[],groups:[],members:[],requests:[],uploads:[],reminders:[],personas:[],occurrences:[],outbox:[]}
    }
    await route.fulfill({json:payload})
  })
  await page.goto('/')
  const nav = page.getByRole('navigation',{name:'企业客户端主导航'})
  await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
  const preview = page.getByRole('region',{name:'任务预览',exact:true,includeHidden:true})
  await expect(preview.getByText('逾期验收群29',{exact:true})).toBeAttached()
  await expect(preview).toBeHidden()
  await expect(page.getByRole('heading',{name:'坐席活跃情况'})).toBeVisible()
  await nav.getByRole('button',{name:/应收款跟进/}).click()
  const report = page.getByRole('region',{name:'收款统计与客户台账'})
  await expect(report.getByRole('heading',{name:'CNY'})).toHaveCount(0)
  await expect(report.getByRole('button',{name:/CNY 未收款总额/})).toContainText('¥ 100.00')
  expect(await report.getByRole('button',{name:'查询',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await page.screenshot({path:info.outputPath('web-receivables-statistics.png'),fullPage:true})
  await report.getByRole('button',{name:'查看与处理'}).click()
  await page.getByLabel('本次收款金额').fill('25.00')
  const dialog = page.getByRole('dialog', {name:'当前任务详情'})
  await expect(dialog.getByText('统一任务收件箱')).toHaveCount(0)
  await expect(dialog.getByText('逾期验收群1', {exact:true})).toHaveCount(0)
  await expect(dialog.getByRole('heading', {name:'网页验收群'})).toBeVisible()
  await page.getByLabel('实际到账时间',{exact:true}).fill('2026-01-01T10:00')
  await page.getByRole('button',{name:'确认登记收款'}).click()
  await expect(page.getByText(/已确认收款：25.00 · 未收余额：75.00/)).toBeVisible()
  await dialog.getByText('备注与负责人转交',{exact:true}).click()
  await page.getByLabel('跟进备注',{exact:true}).fill('已电话跟进，等待余款。')
  await page.getByRole('button',{name:'保存跟进备注'}).click()
  await expect.poll(()=>writes.filter(item=>item.path==='/api/business-followup-manage').length).toBe(1)
  await page.screenshot({path:info.outputPath('web-receivable-ledger.png'),fullPage:true})
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await nav.getByRole('button',{name:/企业 AI 助手/}).click()
  await page.locator('#enterprise-ai-composer').fill('验收售后问题')
  await page.getByRole('button',{name:'提交处理',exact:true}).click()
  await expect(page.getByRole('region',{name:'回答建议',exact:true})).toBeVisible()
  await expect(page.getByRole('region',{name:'继续跟进话术',exact:true})).toBeVisible()
  await expect(page.getByText('备选回答',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:/Markdown/})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'账户安全'})).toBeVisible()
  await page.screenshot({path:info.outputPath('web-answer-parity.png'),fullPage:true})
  expect(errors).toEqual([])
  expect(writes.filter(item=>item.path==='/api/receivable-receipt-action')).toHaveLength(1)
})
