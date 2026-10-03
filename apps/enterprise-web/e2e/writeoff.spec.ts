import { expect, test } from '@playwright/test'
import { receivablesFixture } from './fixtures/receivables'

for (const retry of [false, true]) {
  test(`write-off requires reason and two-stage confirmation; recover=${retry}`, async ({ page }, info) => {
    await receivablesFixture(page)
    let writtenOff = false
    const writes: Record<string, unknown>[] = []
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/business-followup-history') return route.fulfill({ json: {
        available: true, can_add_note: false, can_correct_receipt: false, can_record_receipt: false, transfer_targets: [],
        can_write_off: !writtenOff, version: writtenOff ? 8 : 7, original_amount: '100.00', currency: 'CNY',
        received_amount: '25.00', remaining_amount: writtenOff ? '0.00' : '75.00', receipts: [], history: [],
        writeoffs: writtenOff ? [{amount:'75.00',note:'客户终止合作',recorded_at:'2026-10-03T01:00:00Z',actor_name:'验收管理员'}] : []
      } })
      if (url.pathname === '/api/receivable-receipt-action') {
        writes.push(route.request().postDataJSON())
        writtenOff = true
        if (retry && writes.length === 1) return route.abort('failed')
        return route.fulfill({json:{ok:true, followup_id:'closed', resolution:'written_off'}})
      }
      return route.fallback()
    })
    await page.reload()
    await page.getByRole('navigation').getByRole('button',{name:/应收款跟进/}).click()
    await page.getByRole('button',{name:/CNY 关闭／取消未收/}).click()
    await page.getByRole('row').filter({hasText:'历史测试群'}).getByRole('button',{name:'查看与处理'}).click()
    const dialog = page.getByRole('dialog',{name:'当前任务详情'})
    await dialog.getByRole('button',{name:'冲销未收余额',exact:true}).click()
    await expect(dialog.getByRole('button',{name:'下一步：核对冲销'})).toBeDisabled()
    await dialog.getByLabel('冲销原因（必填）').fill('客户终止合作')
    await dialog.getByRole('button',{name:'下一步：核对冲销'}).click()
    await expect(dialog.getByRole('heading',{name:'再次确认冲销'})).toBeVisible()
    await expect(dialog.getByText(/未收余额归零，不计入已收款/)).toBeVisible()
    expect(writes).toHaveLength(0)
    await dialog.getByRole('button',{name:'取消冲销'}).click()
    expect(writes).toHaveLength(0)
    await dialog.getByRole('button',{name:'冲销未收余额',exact:true}).click()
    await dialog.getByLabel('冲销原因（必填）').fill('客户终止合作')
    await dialog.getByRole('button',{name:'下一步：核对冲销'}).click()
    await page.screenshot({path:info.outputPath('writeoff-confirmation.png'),fullPage:true})
    await dialog.getByRole('button',{name:'确认冲销全部剩余金额'}).click()
    if (retry) {
      await expect(dialog.getByText(/冲销结果尚未确认/)).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByRole('row').filter({hasText:'历史测试群'}).getByRole('button',{name:'查看与处理'}).click()
      await dialog.getByRole('button',{name:'重试原冲销'}).click()
      expect(writes[1]).toEqual(writes[0])
    }
    await expect(dialog.getByText('冲销已完成，原账目已保留在“已冲销”历史中。')).toBeVisible()
    expect(writes[0]).toMatchObject({action:'write_off',followup_id:'closed',amount:'75.00',expected_version:7,note:'客户终止合作'})
    await expect(dialog.getByRole('button',{name:'冲销未收余额',exact:true})).toHaveCount(0)
    await expect(dialog.getByText(/操作人：验收管理员/)).toBeVisible()
  })
}
