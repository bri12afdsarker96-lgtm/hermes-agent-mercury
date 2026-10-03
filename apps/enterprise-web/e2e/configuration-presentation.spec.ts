import {expect, test} from '@playwright/test'
import {uiFixture} from './fixtures/ui'

test('retrieval owns collapsed answer configuration and preserves edits and save contract', async ({page}) => {
  const writes = await uiFixture(page)
  const saves: Record<string, unknown>[] = []
  await page.route('**/api/tenant-ai-config', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    saves.push(route.request().postDataJSON())
    return route.fulfill({json:{configured:true,encryption_ready:true,models:[{
      configuration_id:'saved',provider:'fixture',model:'draft-model',is_default:true
    }],providers:[{key:'fixture',label:'测试厂商',default_model:'test'}]}})
  })
  await page.getByRole('navigation').getByRole('button',{name:/AI模型配置/}).click()
  await expect(page.getByRole('tab',{name:'知识检索',exact:true})).toHaveAttribute('aria-selected','true')
  await expect(page.getByRole('tab',{name:'回答模型',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'新增回答模型',exact:true})).toBeHidden()
  await expect(page.getByText(/每次最多四个/)).toHaveCount(0)
  await expect(page.getByText(/向量检索密钥独立于/)).toHaveCount(0)
  const advanced = page.getByTestId('answer-configuration-disclosure')
  await advanced.locator('summary').first().click()
  await advanced.getByRole('button',{name:'新增回答模型',exact:true}).click()
  await advanced.getByRole('combobox',{name:'AI 厂商',exact:true}).selectOption('fixture')
  await advanced.getByRole('textbox',{name:'模型',exact:true}).fill('draft-model')
  await advanced.getByLabel('API Key',{exact:true}).fill('fixture-test-key')
  await page.getByRole('tab',{name:'人设',exact:true}).click()
  await page.getByRole('tab',{name:'知识检索',exact:true}).click()
  await expect(advanced.getByRole('textbox',{name:'模型',exact:true})).toHaveValue('draft-model')
  expect(writes).toEqual([])
  await advanced.getByRole('button',{name:'安全保存新模型',exact:true}).click()
  await expect(advanced.getByText('draft-model',{exact:true})).toBeVisible()
  expect(saves).toEqual([{action:'upsert_model',provider:'fixture',model:'draft-model',api_key:'fixture-test-key'}])
  await advanced.getByRole('button',{name:'更新',exact:true}).click()
  await expect(advanced.getByLabel('API Key（留空则保留原密钥）',{exact:true})).toHaveValue('')
})
