// Read-only visual review of the shipped build with isolated existing fixtures.
// No production connection or product changes. Screenshots are viewport captures,
// including scroll positions inside nested containers, not just fullPage images.
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import {receivablesFixture} from './fixtures/receivables'
import {uiFixture} from './fixtures/ui'

async function capture(page:Page, info:TestInfo, key:string) {
  const geometry = await page.locator('#enterprise-main').evaluate(root => {
    const elements = [root,...root.querySelectorAll('*')]
    return {
      headings: elements.filter(el=>(/^H[1-6]$/.test(el.tagName)||el.tagName==='SUMMARY')&&el.getBoundingClientRect().height>0).map(el=>({text:el.textContent,y:Math.round(el.getBoundingClientRect().y)})),
      scroll: elements.filter(el=>el.scrollHeight>el.clientHeight+5 && ['auto','scroll'].includes(getComputedStyle(el).overflowY)).map(el=>({class:el.className,top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight})),
    }
  })
  writeFileSync(info.outputPath(`${key}.json`),JSON.stringify(geometry,null,2))
  await page.screenshot({path:info.outputPath(`${key}.png`)})
}
async function sweep(page:Page, info:TestInfo,key:string) {
  const main=page.locator('#enterprise-main')
  await main.evaluate(el=>{el.scrollTop=0;for(const child of Array.from(el.querySelectorAll('*'))) if(['auto','scroll'].includes(getComputedStyle(child).overflowY))child.scrollTop=0})
  await capture(page,info,`${key}-top`)
  const box=await main.boundingBox()
  await page.mouse.move(box!.x+box!.width*.6,box!.y+box!.height*.6)
  for(let step=1;step<=4;step++) {
    const before=await main.evaluate(el=>[el.scrollTop,...Array.from(el.querySelectorAll('*')).filter(e=>e.scrollTop>0).map(e=>e.scrollTop)].join(':'))
    await page.mouse.wheel(0,Math.round(box!.height*.8))
    await page.waitForTimeout(200)
    await capture(page,info,`${key}-wheel-${step}`)
    const after=await main.evaluate(el=>[el.scrollTop,...Array.from(el.querySelectorAll('*')).filter(e=>e.scrollTop>0).map(e=>e.scrollTop)].join(':'))
    if(before===after)break
  }
  // Explicitly record nested bottom states when ordinary wheel stops elsewhere.
  await main.evaluate(el=>{for(const child of Array.from(el.querySelectorAll('*'))) if(['auto','scroll'].includes(getComputedStyle(child).overflowY))child.scrollTop=child.scrollHeight;el.scrollTop=el.scrollHeight})
  await capture(page,info,`${key}-bottom`)
}

test('whole-page financial and reminder scroll inventory',async({page},info)=>{
  test.setTimeout(120000)
  await page.setViewportSize({width:1366,height:768})
  await receivablesFixture(page)
  const writes:string[]=[]
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.method()!=='GET')writes.push(r.url())})
  await page.getByRole('navigation').getByRole('button',{name:'运营总览',exact:true}).click()
  await sweep(page,info,'overview')
  await expect(page.getByTestId('operations-overview')).toBeVisible()
  await expect(page.getByRole('heading',{name:'坐席活跃情况'})).toBeVisible()
  for (const name of ['运营数据看板','员工组别','下属定时任务提醒（只读）','服务端时间与提醒规则']) {
    await expect(page.getByRole('heading',{name,exact:true})).toHaveCount(0)
  }
  await expect(page.locator('.hesc-workbench-shortcuts')).toBeHidden()
  await expect(page.getByRole('region',{name:'任务预览',includeHidden:true})).toBeHidden()
  await page.setViewportSize({width:960,height:540})
  await sweep(page,info,'overview-narrow')
  await page.setViewportSize({width:1366,height:768})
  for(const [key,name] of [['receivables','应收款跟进'],['reminders','提醒中心'],['overdue','逾期未处理']] as const) {
    await page.getByRole('navigation').getByRole('button',{name:new RegExp(name)}).click()
    await sweep(page,info,key)
    if(key==='receivables') {
      await page.getByText('当前明细按业务对象 / 群名称汇总',{exact:true}).click()
      await sweep(page,info,'receivables-expanded')
      await page.getByRole('button',{name:'历史记录',exact:true}).click()
      await capture(page,info,'receivables-history')
      await page.getByRole('button',{name:'查看与处理'}).first().click()
      const dialog=page.getByRole('dialog',{name:'当前任务详情'})
      await expect(dialog.getByRole('heading',{name:'历史测试群'})).toBeVisible()
      await page.screenshot({path:info.outputPath('receipt-detail.png')})
      const bounds=await dialog.boundingBox()
      await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height*.75)
      await page.mouse.wheel(0,600)
      await page.waitForTimeout(200)
      await page.screenshot({path:info.outputPath('receipt-detail-bottom.png')})
      await page.keyboard.press('Escape')
    }
    if(key==='reminders') {
      await page.getByRole('button',{name:'个人提醒',exact:true}).click()
      await sweep(page,info,'reminders-personal')
      await page.getByRole('button',{name:'处理历史',exact:true}).click()
      await sweep(page,info,'reminders-history')
      await page.getByRole('button',{name:'通知设置与记录',exact:true}).click()
      for(const label of ['提醒触发历史','通知投递记录']) {
        await page.locator('summary').filter({hasText:label}).click()
      }
      await sweep(page,info,'reminders-expanded')
      await page.getByRole('button',{name:'新建提醒',exact:true}).click()
      await sweep(page,info,'reminders-ai-draft')
      await page.getByRole('button',{name:'手动填写',exact:true}).click()
      await sweep(page,info,'reminders-manual-draft')
      const nested=await page.locator('.hesc-reminder-dialog[data-inline=true]').evaluate(el=>el.scrollHeight>el.clientHeight+5&&['auto','scroll'].includes(getComputedStyle(el).overflowY))
      expect(nested).toBe(false)
    }
  }
  expect(writes).toEqual([])
})

test('narrow layouts keep navigation, reminder dates and chat composer reachable',async({page},info)=>{
  test.setTimeout(90000)
  const writes=await uiFixture(page)
  for(const viewport of [{width:1024,height:768},{width:960,height:540},{width:959,height:540},{width:683,height:384}]) {
    await page.setViewportSize(viewport)
    await page.getByRole('navigation').getByRole('button',{name:/提醒中心/}).click()
    await page.getByRole('button',{name:'新建提醒',exact:true}).click()
    await page.getByRole('button',{name:'手动填写',exact:true}).click()
    await page.getByLabel('个人提醒日期',{exact:true}).scrollIntoViewIfNeeded()
    await expect(page.getByLabel('个人提醒日期',{exact:true})).toBeInViewport()
    await expect(page.getByLabel('个人提醒时间',{exact:true})).toBeInViewport()
    await page.getByRole('button',{name:'确认创建提醒',exact:true}).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button',{name:'确认创建提醒',exact:true})).toBeInViewport()
    await page.getByRole('navigation').getByRole('button',{name:/企业 AI 助手/}).click()
    const submit=page.getByRole('button',{name:'提交处理',exact:true})
    await submit.scrollIntoViewIfNeeded()
    await expect(submit).toBeInViewport()
    await expect(page.getByLabel('输入内容',{exact:true})).toBeInViewport()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await page.screenshot({path:info.outputPath(`narrow-assistant-${viewport.width}.png`)})
  }
  expect(writes).toEqual([])
})

test('whole-page configuration and knowledge scroll inventory',async({page},info)=>{
  test.setTimeout(180000)
  await page.setViewportSize({width:1366,height:768})
  const writes=await uiFixture(page)
  for(const [key,name] of [['knowledge','企业知识'],['models','AI模型配置'],['members','员工与权限'],['tools','工具集'],['assistant','企业 AI 助手']] as const) {
    await page.getByRole('navigation').getByRole('button',{name:new RegExp(name)}).click()
    await sweep(page,info,key)
    if(key==='knowledge') {
      for(const [id,label] of [['upload','上传知识'],['gaps','知识缺口']]) {
        await page.getByRole('button',{name:label,exact:true}).click()
        await sweep(page,info,`knowledge-${id}`)
      }
    }
    if(key==='models') {
      await page.getByTestId('answer-configuration-disclosure').locator('summary').first().click()
      await page.getByRole('button',{name:'新增回答模型',exact:true}).click()
      await sweep(page,info,'model-create')
      await page.getByRole('tab',{name:'知识检索',exact:true}).click()
      await page.getByRole('tabpanel').locator('summary').filter({hasText:'编辑知识检索配置'}).click()
      await sweep(page,info,'model-embedding')
      await page.getByRole('tab',{name:'人设',exact:true}).click()
      await sweep(page,info,'model-persona')
    }
    if(key==='members') {
      await page.locator('summary').filter({hasText:'开通员工账号'}).click()
      await sweep(page,info,'member-create')
      for(const label of ['组别','待审批']) {
        await page.getByRole('tab',{name:new RegExp(label)}).click()
        await sweep(page,info,`members-${label}`)
      }
    }
    if(key==='tools') {
      for(const label of ['通知设置与记录','企业通知渠道']) {
        await page.getByRole('tab',{name:label,exact:true}).click()
        await sweep(page,info,`tools-${label}`)
      }
    }
  }
  await page.getByRole('button',{name:'账户安全',exact:true}).click()
  await page.screenshot({path:info.outputPath('account-security.png')})
  await page.keyboard.press('Escape')
  expect(writes).toEqual([])
})
