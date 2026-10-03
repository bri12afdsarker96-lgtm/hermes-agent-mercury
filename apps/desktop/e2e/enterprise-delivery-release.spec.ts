/** Packaged renderer/preload/IPC acceptance with isolated contract fixtures.
 * This never modifies production users, receivables, passwords or knowledge.
 */
import path from 'node:path'
import { _electron, test, expect, type ElectronApplication } from '@playwright/test'
import { buildAppEnv, createSandbox } from './fixtures'
import pkg from '../package.json' with { type: 'json' }

test('packaged delivery iteration exposes complete daily workflows', async ({}, info) => {
  test.setTimeout(120_000)
  const sandbox = createSandbox('delivery-release', {initialWindowSize:{width:1280,height:900}})
  const env = buildAppEnv(sandbox, {HERMES_DESKTOP_BOOT_FAKE:'1'})
  delete env.HERMES_DESKTOP_HERMES_ROOT
  delete env.HERMES_DESKTOP_DEV_SERVER
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  try {
    app = await _electron.launch({executablePath:path.resolve('release',pkg.version,'win-unpacked','HermesEnterpriseAssistant.exe'), args:['--disable-gpu','--no-sandbox'],env})
    const page = await app.firstWindow()
    expect(await app.evaluate(({app}) => app.getVersion())).toBe(pkg.version)
    expect(page.url()).toContain('app.asar')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ipcMain}) => {
      const identity = {principal_id:'fixture-admin',tenant_id:'fixture-tenant',tenant_name:'预发布验收企业',name:'验收管理员',role:'tenant_admin',effective_permissions:['*'],product_capabilities:{enterprise_chat:{enabled:true,status:'LIVE'},knowledge_rag:{enabled:true,status:'LIVE'}},desktop_surfaces:{schema_version:1,surfaces:{knowledge:{available:true},workflows:{available:true}}}}
      const followups: Record<string,unknown>[] = []
      const overdueRows = Array.from({length:30},(_,i) => ({source_id:`due-${i}`,source_type:'receivable_followup',task_source_label:'应收款跟进',business_subject:`逾期验收群${i}`,owner_principal_id:'fixture-seat',owner_name:'验收坐席',status:'followup_due',task_status:'overdue',overdue:true,allowed_actions:[],next_followup_at:'2026-09-10T09:00:00+08:00'}))
      const historical = ['closed','completed','cancelled'].map((status,i) => ({...overdueRows[0],source_id:`history-${i}`,business_subject:`历史验收${status}`,status,overdue:false,updated_at:`2026-09-${20+i}T09:00:00+08:00`}))
      let connected = true
      for (const name of ['auto-connect','disconnect','request','remembered-login']) {ipcMain.removeHandler(`hermes:enterprise:${name}`)}
      ipcMain.handle('hermes:enterprise:auto-connect',()=>connected ? {ok:true,sessionId:'fixture-session',baseUrl:'http://127.0.0.1:49152'} : {ok:false,code:'no_native_session'})
      ipcMain.handle('hermes:enterprise:disconnect',()=>{connected=false;return {ok:true}})
      ipcMain.handle('hermes:enterprise:remembered-login',()=>({rememberPassword:false,loginName:'',password:''}))
      ipcMain.handle('hermes:enterprise:request',(_event,req) => {
        const query = new URL(req.path,'http://fixture.invalid')
        const route = query.pathname
        let data: unknown
        switch (route) {
          case '/api/whoami': data=identity; break
          case '/api/health': data={ok:true,auth_mode:'strict'}; break
          case '/api/metrics': data={alerts:[]}; break
          case '/api/operations-overview': data={groups:[],knowledge:{pending_review:0,published:338},knowledge_available:true,reminders:[],scope:{operator_count:10,read_only:false},staff:[],summary:{today_questions:0,today_answers:0,today_customer_replies:0,week_answers:0,total_answers:0,total_customer_replies:0}}; break
          case '/api/operations-reminders': data={reminders:[]}; break
          case '/api/assistant-reminders': data={reminders:[]}; break
          case '/api/reminder-center': data={available:true,tasks:[...followups,...overdueRows],wecom_direct_reminder_ready:false}; break
          case '/api/reminder-occurrences': data={available:true,occurrences:[]}; break
          case '/api/delivery-outbox': data={available:true,outbox:[]}; break
          case '/api/tenant-ai-models': data={configured:true,models:[{configuration_id:'fixture-model',is_default:true,model:'验收模型',provider:'fixture'}]}; break
          case '/api/tenant-ai-personas': data={personas:[{persona_id:'customer-service',name:'智能客服',is_default:true}]}; break
          case '/api/tenant-ai-assist': data={answer_text:'请提供订单资料以便核实。请补充订单号、商品包装和异常照片，我们会根据企业售后流程核对信息，再向您说明后续处理步骤。在资料核验完成前，不预设处理结果，也不会将内部检索摘要直接作为对客回复。',reasoning_summary:'先核实资料，不预设处理结果。',customer_reply_options:[{kind:'current_reply',text:'请提供订单资料以便核实。请补充订单号、商品包装和异常照片，我们会根据企业售后流程核对信息，再向您说明后续处理步骤。在资料核验完成前，不预设处理结果，也不会将内部检索摘要直接作为对客回复。'},{kind:'follow_up',text:'资料收到后继续跟进。'},{kind:'alternative_reply',text:'您也可以提供包装照片。'}],retrieval_meta:{matched_count:2,candidate_count:6,status:'hit',best_similarity:0.8,similarity_threshold:0.5}}; break
          case '/api/knowledge-uploads': data={uploads:[{upload_id:'fixture-upload',filename:'售后规则.txt',status:'staged',created_ts:1789000000}],count:1}; break
          case '/api/knowledge-preview': data={upload_id:'fixture-upload',total:2,chunks:[{text:'第一条售后规则'},{text:'第二条售后规则'}]}; break
          case '/api/knowledge-rechunk': data={upload_id:'fixture-upload',total:1,chunks:[{text:'重新切分后的售后规则'}]}; break
          case '/api/knowledge-pending': data={pending:[]}; break
          case '/api/knowledge-candidates': data={candidates:[],permissions:['*'],role:'tenant_admin',principal_id:'fixture-admin',total:0,counts:{}}; break
          case '/api/knowledge-published': data={published:[],entries:[]}; break
          case '/api/knowledge-gaps': data={gaps:[]}; break
          case '/api/knowledge-conflicts': data={conflicts:[]}; break
          case '/api/seat-requests': data={requests:[]}; break
          case '/api/password-change': data={ok:true}; break
          case '/api/receivables-report': {
            const history = query.searchParams.get('detail_view') === 'history'
            const status = query.searchParams.get('status')
            const keyword = query.searchParams.get('query') ?? ''
            const rows = (history ? historical : [...followups,...overdueRows])
              .filter(row => (!status || status === 'all' || row.status === status) && String(row.business_subject).includes(keyword))
              .map(row => ({amount:'100.00',currency:'CNY',received_amount:'0.00',remaining_amount:'100.00',...row}))
            data={available:true,as_of_date:'2026-10-03',page:1,page_size:100,total:rows.length,followups:rows,daily:[],customers:[],
              scope_options:{current_principal_id:'fixture-admin',groups:[{group_id:'team',name:'验收团队'}],people:[{principal_id:'fixture-seat',name:'验收坐席',role:'operator',group_id:'team',active:true}]},
              summary_totals:[{currency:'CNY',due_today:'100.00',unpaid:'3000.00',overdue:'2900.00',outstanding:'3000.00',inactive:'0.00',received:'0.00',receivable:'3000.00'}]}
            break
          }
          case '/api/business-followup-history': data={available:true,can_record_receipt:true,can_correct_receipt:true,can_add_note:true,transfer_targets:[],received_amount:'0.00',remaining_amount:'128.30',receipts:[],history:[]}; break
          case '/api/business-followups':
            if (req.method === 'POST') {
              const existing = followups.find(row=>row.idempotency_key===req.body.idempotency_key)
              const row = existing ?? {...req.body,source_id:'fixture-followup',source_type:'receivable_followup',task_source_label:'应收款跟进',owner_principal_id:'fixture-admin',owner_name:'验收管理员',status:'open',task_status:'pending',currency:'CNY',overdue:false,allowed_actions:['received','cancel','close'],next_followup_at:'2026-10-20T09:00:00+08:00'}
              if (!existing) {followups.push(row)}
              data={ok:true,followup:row}
            } else {data=query.searchParams.has('followup_id') ? {followup:followups[0]} : {available:true,followups:[...followups,...overdueRows,...historical]}}
            break
          default: data={available:false,configured:false,entries:[],groups:[],members:[],requests:[],uploads:[],reminders:[],personas:[]}
        }
        return {kind:'ok',data}
      })
    })
    await page.reload()
    await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,900))
    await page.setViewportSize({width:1280,height:900})
    const nav = page.getByRole('navigation',{name:'企业客户端主导航'})
    const preview = page.getByRole('region',{name:'逾期事项预览'})
    await expect(preview).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'当前身份范围'})).toHaveCount(0)
    await page.getByRole('article',{name:'收款金额概览'}).getByRole('button',{name:/未收款总额/}).click()
    await expect(page.getByRole('region',{name:'对应任务明细'}).getByRole('heading')).toContainText('未收款总额')
    await nav.getByRole('button',{name:/逾期未处理/}).click()
    await expect(page.getByRole('heading',{name:'逾期未处理',exact:true})).toBeVisible()
    await expect(page.getByRole('table').getByRole('cell',{name:/^逾期验收群29/})).toBeAttached()
    await page.getByRole('heading',{name:'逾期未处理',exact:true}).scrollIntoViewIfNeeded()
    await page.screenshot({path:info.outputPath('overdue-list.png')})
    await expect(nav.getByRole('button',{name:/应收款跟进/})).toBeVisible()
    await page.screenshot({path:info.outputPath('workbench-1280.png')})
    await nav.getByRole('button',{name:/应收款跟进/}).click()
    await expect(page.getByText('历史验收closed',{exact:true})).toHaveCount(0)
    await page.getByRole('button',{name:'历史记录',exact:true}).click()
    await page.getByRole('combobox').filter({has:page.locator('option[value="closed"]')}).selectOption('closed')
    await page.getByRole('button',{name:'查询',exact:true}).click()
    await expect(page.getByText('历史验收closed',{exact:true})).toBeVisible()
    await expect(page.getByText('历史验收completed',{exact:true})).toHaveCount(0)
    const report = page.getByRole('region',{name:'收款统计与客户台账'})
    await report.getByLabel('业务对象 / 群名称',{exact:true}).fill('closed')
    await report.getByRole('button',{name:'查询',exact:true}).click()
    await page.screenshot({path:info.outputPath('followup-history.png')})
    await report.getByRole('button',{name:'清空筛选',exact:true}).click()
    await report.getByRole('combobox').filter({has:page.locator('option[value="team"]')}).selectOption('team')
    await expect(report.getByRole('combobox').filter({has:page.locator('option[value="id:fixture-seat"]')}).locator('option')).toHaveText(['该团队全部负责人','验收坐席'])
    await page.getByRole('button',{name:'新建应收款',exact:true}).click()
    const create = page.getByRole('dialog',{name:'新建应收款',exact:true})
    await create.getByLabel('业务对象 / 群名称',{exact:true}).fill('验收服务费')
    await create.getByLabel('应收金额（元）',{exact:true}).fill('128.30')
    await create.getByLabel('预计到账日期',{exact:true}).fill('2026-10-20')
    await create.getByRole('button',{name:'创建应收款',exact:true}).click()
    await expect(page.getByText('已创建，提醒已同步到提醒中心。')).toBeVisible()
    await page.screenshot({path:info.outputPath('receivables-1280.png')})
    await page.keyboard.press('Escape')
    await page.getByRole('row').filter({hasText:'验收服务费'}).getByRole('button',{name:'查看与处理',exact:true}).click()
    const detail = page.getByRole('dialog',{name:'当前任务详情'})
    await expect(detail.getByRole('heading',{name:'验收服务费',exact:true})).toBeVisible()
    await expect(detail.getByRole('button',{name:'确认全部收款',exact:true})).toBeEnabled()
    await expect(detail.getByText('逾期验收群29',{exact:true})).toHaveCount(0)
    await page.keyboard.press('Escape')
    await nav.getByRole('button',{name:/企业 AI 助手/}).click()
    await page.locator('#enterprise-ai-composer').fill('验收售后问题')
    await page.getByRole('button',{name:'提交处理',exact:true}).click()
    await expect(page.getByText('请提供订单资料以便核实。请补充订单号、商品包装和异常照片，我们会根据企业售后流程核对信息，再向您说明后续处理步骤。在资料核验完成前，不预设处理结果，也不会将内部检索摘要直接作为对客回复。',{exact:true})).toHaveCount(1)
    await expect(page.getByText('继续跟进话术',{exact:true})).toBeVisible()
    await expect(page.getByText('备选回答',{exact:true})).toBeVisible()
    await expect(page.getByRole('region',{name:'企业知识检索（本次）'})).toBeVisible()
    const primaryReply = page.getByRole('region',{name:'回答建议',exact:true})
    const followupReply = page.getByRole('region',{name:'继续跟进话术',exact:true})
    await expect(page.getByRole('button',{name:/Markdown/})).toHaveCount(0)
    await expect(primaryReply.getByRole('button',{name:'点击复制',exact:true})).toBeVisible()
    const cardStyle = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      const text = getComputedStyle(element.querySelector('.hesc-reply-text')!)
      const button = getComputedStyle(element.querySelector('button')!)
      return {border:style.border,background:style.backgroundColor,radius:style.borderRadius,font:Number.parseFloat(text.fontSize),buttonBackground:button.backgroundColor,buttonFont:Number.parseFloat(button.fontSize)}
    }
    const primaryStyle = await primaryReply.evaluate(cardStyle)
    expect(primaryStyle).toEqual(await followupReply.evaluate(cardStyle))
    expect(primaryStyle.border).toMatch(/^1px solid/)
    expect(primaryStyle.font).toBeGreaterThanOrEqual(16)
    expect(primaryStyle.buttonFont).toBeGreaterThanOrEqual(14)
    expect(await nav.getByRole('button',{name:/企业 AI 助手/}).evaluate(element=>Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(15)
    await primaryReply.scrollIntoViewIfNeeded()
    await page.screenshot({path:info.outputPath('answers-1280.png')})
    for (const viewport of [{width:1920,height:1080},{width:1024,height:768}]) {
      await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size.width,size.height),viewport)
      await page.setViewportSize(viewport)
      await primaryReply.scrollIntoViewIfNeeded()
      await expect(primaryReply.getByRole('button',{name:'点击复制',exact:true})).toBeVisible()
      expect(await primaryReply.evaluate(element=>element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(await page.locator('.hesc-ai-history-heading strong').evaluate(element=>element.getBoundingClientRect().height)).toBeLessThan(40)
      expect(await page.getByRole('button',{name:'提交处理',exact:true}).evaluate(element=>element.getBoundingClientRect().height)).toBeLessThan(60)
      await page.screenshot({path:info.outputPath(`answers-${viewport.width}.png`)})
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,900))
    await page.setViewportSize({width:1280,height:900})
    await page.getByRole('button',{name:'账户安全',exact:true}).click()
    await page.getByLabel('当前密码',{exact:true}).fill('fixture-old-password')
    await page.getByLabel('新密码',{exact:true}).fill('fixture-new-password')
    await page.getByLabel('确认新密码',{exact:true}).fill('fixture-new-password')
    await page.getByRole('button',{name:'修改密码',exact:true}).click()
    await expect(page.getByText('密码已修改，当前会话已更新。')).toBeVisible()
    await page.screenshot({path:info.outputPath('account-1280.png')})
    await page.getByRole('button',{name:'关闭',exact:true}).click()
    await nav.getByRole('button',{name:/企业知识/}).click()
    await page.getByRole('button',{name:'上传知识',exact:true}).click()
    await page.getByText('历史上传',{exact:true}).click()
    await page.getByRole('button',{name:'继续处理',exact:true}).click()
    await expect(page.getByText('第一条售后规则',{exact:true})).toBeVisible()
    await page.locator('summary').filter({hasText:'重新切分'}).click()
    await page.getByRole('button',{name:'重新切分',exact:true}).click()
    await expect(page.getByText('重新切分后的售后规则',{exact:true})).toBeVisible()
    await page.screenshot({path:info.outputPath('knowledge-1280.png')})
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1920,1080))
    await page.setViewportSize({width:1920,height:1080})
    await nav.getByRole('button',{name:/运营总览/}).click()
    await page.screenshot({path:info.outputPath('workbench-1920.png')})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button',{name:'账户安全',exact:true}).click()
    await page.getByRole('button',{name:'退出登录',exact:true}).click()
    await expect(page.getByRole('heading',{name:'登录企业账号',exact:true})).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app?.close()
    sandbox.cleanup()
  }
})
