import {expect, type Page} from '@playwright/test'
export async function uiFixture(page: Page) {
  const writes: string[] = []
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') writes.push(path)
    let body: unknown = {available:false,configured:false,entries:[],groups:[],members:[],principals:[],requests:[],uploads:[],reminders:[],personas:[],occurrences:[],outbox:[],tasks:[]}
    switch(path) {
      case '/api/whoami': body={principal_id:'admin',tenant_id:'audit',name:'审查管理员',tenant_name:'审查企业',role:'tenant_admin',effective_permissions:['*'],product_capabilities:{enterprise_chat:{enabled:true,status:'LIVE'},knowledge_rag:{enabled:true,status:'LIVE'}},desktop_surfaces:{schema_version:1,surfaces:{knowledge:{available:true},workflows:{available:true},governance:{available:true}}}};break
      case '/api/health':body={ok:true,auth_mode:'strict'};break
      case '/api/metrics':body={alerts:[]};break
      case '/api/operations-overview':body={groups:[],knowledge:{},scope:{},staff:[],summary:{},reminders:[]};break
      case '/api/reminder-center':body={available:true,tasks:[]};break
      case '/api/business-followups':body={available:true,followups:[]};break
      case '/api/receivables-report':body={available:true,as_of_date:'2026-10-03',total:0,page:1,page_size:25,summary_totals:[],daily:[],daily_from:'2026-10-03',daily_to:'2026-10-09',followups:[]};break
      case '/api/operations-groups':body={groups:[{group_id:'g1',name:'测试组',manager_principal_id:'admin',owner_name:'审查管理员',member_count:1}],managers:[{principal_id:'admin',name:'审查管理员',role:'tenant_admin'}],operators:[{principal_id:'seat',name:'测试坐席',group_id:'g1',group_name:'测试组'}]};break
      case '/api/tenant-ai-config':body={configured:false,encryption_ready:true,models:[],providers:[{key:'fixture',label:'测试厂商',default_model:'test'}]};break
      case '/api/tenant-embedding-config':body={configured:false,encryption_ready:true,profiles:[],providers:[{key:'fixture',label:'测试向量厂商'}]};break
      case '/api/knowledge-candidates':body={role:'tenant_admin',principal_id:'admin',permissions:['kb.upload','kb.author','kb.delete','kb.candidate.review','kb.candidate.approve','kb.candidate.publish'],has_more:false,candidates:[{candidate_id:'candidate1',topic:'测试知识',text:'这是只读知识原文。',status:'needs_review',risk_level:'low',created_by_principal_id:'author',retrievable:false}]};break
      case '/api/knowledge-status':body={published:1,pending_review:1};break
    }
    await route.fulfill({json:body})
  })
  await page.goto('/')
  await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
  return writes
}
