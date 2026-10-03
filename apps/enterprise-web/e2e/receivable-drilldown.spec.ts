import { expect, test, type Page } from '@playwright/test'

import { receivablesFixture as fixture } from './fixtures/receivables'

test('all six overview amounts map directly to their matching detail list', async ({ page }, info) => {
  const requests = await fixture(page)
  const nav = page.getByRole('navigation', { name: '企业客户端主导航' })
  const mappings = [
    ['当日待收款', 'due_today', 1],
    ['逾期未收款', 'overdue', 1],
    ['未收款总额', 'unpaid', 4],
    ['跟进中未收', 'outstanding', 3],
    ['关闭／取消未收', 'inactive', 1],
    ['已确认收款', 'received', 2]
  ] as const
  for (const [label, bucket, count] of mappings) {
    const overview = page.getByRole('article', { name: '收款金额概览' })
    await expect(page.getByRole('heading', { name: '当前身份范围' })).toHaveCount(0)
    await overview.getByRole('button', { name: new RegExp(label) }).click()
    const details = page.getByRole('region', { name: '对应任务明细' })
    await expect(details.getByRole('heading')).toContainText(label)
    await expect(details.locator('tbody tr')).toHaveCount(count)
    expect(
      requests
        .filter(url => url.pathname === '/api/receivables-report')
        .at(-1)
        ?.searchParams.get('bucket')
    ).toBe(bucket)
    const report = page.getByRole('region', { name: '收款统计与客户台账' })
    await expect(report.getByRole('button', { name: /未收款总额/ })).toContainText('380.00')
    if (bucket === 'unpaid') await page.screenshot({ path: info.outputPath('overview-to-unpaid.png'), fullPage: true })
    await nav.getByRole('button', { name: /运营总览/ }).click()
  }
})

test('overview counts and task links preserve their task-set meanings', async ({page}) => {
  await fixture(page)
  const nav=page.getByRole('navigation')
  const overview=page.getByTestId('enterprise-client-workbench')
  await overview.locator('.hesc-kpis').getByRole('button',{name:/逾期未处理/}).click()
  await expect(page.getByRole('heading',{name:'逾期未处理',exact:true})).toBeVisible()
  await expect(page.getByRole('row').filter({hasText:'明日测试群'})).toHaveCount(0)
  await nav.getByRole('button',{name:/运营总览/}).click()
  await overview.locator('.hesc-kpis').getByRole('button',{name:/待跟进事项/}).click()
  const inbox=page.getByRole('region',{name:'统一任务收件箱'})
  await expect(inbox.getByRole('button',{name:'全部',exact:true})).toHaveAttribute('aria-pressed','true')
  await inbox.getByRole('button',{name:'个人提醒',exact:true}).click()
  await nav.getByRole('button',{name:/运营总览/}).click()
  await overview.locator('.hesc-kpis').getByRole('button',{name:/待跟进事项/}).click()
  await expect(inbox.getByRole('button',{name:'全部',exact:true})).toHaveAttribute('aria-pressed','true')
  await inbox.locator('article').filter({hasText:'个人测试提醒'}).getByRole('button',{name:'查看详情'}).click()
  const detail=page.getByRole('dialog',{name:'当前任务详情'})
  await expect(detail.getByRole('heading',{name:'个人测试提醒'})).toBeVisible()
  await expect(detail.getByText('明日测试群')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await nav.getByRole('button',{name:/运营总览/}).click()
  await overview.locator('.hesc-kpis').getByRole('button',{name:/逾期未处理/}).click()
  await page.getByRole('row').filter({hasText:'逾期测试群'}).getByRole('button',{name:'查看与处理'}).click()
  await expect(detail.getByRole('heading',{name:'逾期测试群'})).toBeVisible()
})

test('date, metric and history switches replace the same list and preserve applied search', async ({ page }) => {
  const requests = await fixture(page)
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /应收款跟进/ })
    .click()
  const report = page.getByRole('region', { name: '收款统计与客户台账' })
  const details = report.getByRole('region', { name: '对应任务明细' })
  await expect(details.getByRole('row').filter({ hasText: '今日测试群' })).toBeVisible()
  await report
    .getByRole('region', { name: '每日待收金额' })
    .getByRole('button', { name: /2026-10-03/ })
    .click()
  await expect(details.getByRole('row').filter({ hasText: '明日测试群' })).toBeVisible()
  await expect(details.getByRole('row').filter({ hasText: '今日测试群' })).toHaveCount(0)
  await report.getByRole('button', { name: /关闭／取消未收/ }).click()
  await expect(details.getByRole('row').filter({ hasText: '历史测试群' })).toBeVisible()
  expect(
    requests
      .filter(url => url.pathname === '/api/receivables-report')
      .at(-1)
      ?.searchParams.has('due_date')
  ).toBe(false)
  await report.getByRole('button', { name: '历史记录', exact: true }).click()
  await expect(details.locator('tbody tr')).toHaveCount(2)
  await report.getByRole('button', { name: '当前跟进', exact: true }).click()
  await expect(details.locator('tbody tr')).toHaveCount(3)
  await report.getByRole('textbox', { name: '业务对象 / 群名称', exact: true }).fill('今日')
  await report.getByRole('button', { name: '查询', exact: true }).click()
  await expect(details.locator('tbody tr')).toHaveCount(1)
  await report.getByRole('button', { name: /未收款总额/ }).click()
  await expect(details.locator('tbody tr')).toHaveCount(1)
  expect(
    requests
      .filter(url => url.pathname === '/api/receivables-report')
      .at(-1)
      ?.searchParams.get('query')
  ).toBe('今日')
  await details.getByRole('button', { name: '查看与处理' }).click()
  const dialog = page.getByRole('dialog', { name: '当前任务详情' })
  await expect(dialog.getByRole('heading', { name: '今日测试群', exact: true })).toBeVisible()
  await expect(dialog.getByText('明日测试群', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(report.getByRole('textbox', { name: '业务对象 / 群名称', exact: true })).toHaveValue('今日')
  await expect(details.locator('tbody tr')).toHaveCount(1)
})

test('overdue personal reminder opens only that reminder and completing it stays in the detail', async ({ page }) => {
  await fixture(page)
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /逾期未处理/ })
    .click()
  const taskRow = page.getByRole('row').filter({ hasText: '个人测试提醒' })
  await taskRow.getByRole('button').click()
  const dialog = page.getByRole('dialog', { name: '当前任务详情' })
  await expect(dialog.getByRole('heading', { name: '个人测试提醒', exact: true })).toBeVisible()
  await expect(dialog.getByText('逾期测试群', { exact: true })).toHaveCount(0)
  await expect(dialog.getByText('统一任务收件箱')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '确认登记收款' })).toHaveCount(0)
  await dialog.getByRole('button', { name: '完成提醒', exact: true }).click()
  await dialog.getByRole('button', { name: '确认操作', exact: true }).click()
  await expect(dialog.getByText('当前任务已更新。')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '完成提醒', exact: true })).toHaveCount(0)
})
