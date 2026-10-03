import { expect, test, type Page } from '@playwright/test'

// Built app + real browser cookie jar. No production accounts or writes.
async function fixture(page: Page, logoutStatus = 200) {
  await page
    .context()
    .addCookies([
      { name: 'hermes_fixture', value: 'signed-in', url: 'http://127.0.0.1:4185', httpOnly: true, sameSite: 'Strict' }
    ])
  const posts: string[] = []
  await page.route('**/api/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'POST') {
      posts.push(path)
    }
    if (path === '/api/browser-logout') {
      await route.fulfill({
        status: logoutStatus,
        json: { ok: logoutStatus === 200 },
        headers:
          logoutStatus === 200 ? { 'Set-Cookie': 'hermes_fixture=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict' } : {}
      })
      return
    }
    if (!(await req.allHeaders()).cookie?.includes('hermes_fixture=signed-in')) {
      await route.fulfill({ status: 401, json: { error: 'unauthorized' } })
      return
    }
    let payload: unknown = { available: false, reminders: [], tasks: [], groups: [], members: [], requests: [] }
    switch (path) {
      case '/api/whoami':
        payload = {
          principal_id: 'fixture',
          tenant_id: 'fixture',
          tenant_name: '测试企业',
          name: '测试管理员',
          role: 'tenant_admin',
          effective_permissions: ['*'],
          product_capabilities: { enterprise_chat: { enabled: true, status: 'LIVE' } },
          desktop_surfaces: { schema_version: 1, surfaces: {} }
        }
        break
      case '/api/health':
        payload = { ok: true, auth_mode: 'strict' }
        break
      case '/api/metrics':
        payload = { alerts: [] }
        break
      case '/api/operations-overview':
        payload = { groups: [], knowledge: {}, scope: {}, staff: [], summary: {}, reminders: [] }
        break
      case '/api/tenant-ai-models':
        payload = {
          configured: true,
          models: [{ configuration_id: 'fixture', is_default: true, model: '测试模型', provider: 'fixture' }]
        }
        break
      case '/api/tenant-ai-personas':
        payload = { personas: [{ persona_id: 'customer-service', name: '智能客服', is_default: true }] }
        break
    }
    await route.fulfill({ json: payload })
  })
  await page.goto('/')
  await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
  return posts
}

test('refresh and focus retain cookie; explicit logout expires it and reload stays signed out', async ({ page }) => {
  const posts = await fixture(page)
  await page.reload()
  await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(posts).not.toContain('/api/browser-logout')
  await page.getByRole('button', { name: '账户安全', exact: true }).click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录企业工作台', exact: true })).toBeVisible()
  expect(posts.filter(path => path === '/api/browser-logout')).toHaveLength(1)
  expect((await page.context().cookies()).find(cookie => cookie.name === 'hermes_fixture')).toBeUndefined()
  await page.reload()
  await expect(page.getByRole('button', { name: '登录企业工作台', exact: true })).toBeVisible()
})

test('logout service failure keeps account controls open with retryable error', async ({ page }) => {
  await fixture(page, 503)
  await page.getByRole('button', { name: '账户安全', exact: true }).click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('操作未完成')
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled()
  await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
})

test('built browser waits beyond old 20-second cutoff and renders delayed answer exactly once', async ({ page }) => {
  const posts = await fixture(page)
  await page.clock.install()
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /企业 AI 助手/ })
    .click()
  let finish: () => void = () => {}
  let started = false
  await page.route('**/api/tenant-ai-assist', async route => {
    posts.push('/api/tenant-ai-assist')
    started = true
    await new Promise<void>(resolve => {
      finish = resolve
    })
    await route.fulfill({
      json: {
        answer_text: '超过二十秒的测试回答',
        reasoning_summary: '测试',
        customer_reply_options: [{ kind: 'current_reply', text: '超过二十秒的测试回答' }]
      }
    })
  })
  await page.locator('#enterprise-ai-composer').fill('等待测试')
  await page.getByRole('button', { name: '提交处理', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  await page.clock.fastForward(21_000)
  finish()
  await expect(page.getByRole('region', { name: '回答建议', exact: true })).toContainText('超过二十秒的测试回答')
  expect(posts.filter(path => path === '/api/tenant-ai-assist')).toHaveLength(1)
})

for (const permission of ['default', 'denied', 'unsupported'] as const) {
  test(`notification settings explain ${permission} without unsolicited permission prompts`, async ({ page }) => {
    await page.addInitScript(
      ({ permission }) => {
        const state = { permission, prompts: 0, notifications: [] as unknown[] }
        Object.assign(window, { notificationTestState: state })
        if (permission === 'unsupported') {
          delete (window as unknown as Record<string, unknown>).Notification
          return
        }
        Object.defineProperty(window, 'Notification', {
          configurable: true,
          value: class {
            static get permission() {
              return state.permission
            }
            static async requestPermission() {
              state.prompts++
              state.permission = 'granted' as typeof permission
              return 'granted'
            }
            constructor(title: string, options: unknown) {
              state.notifications.push({ title, options })
            }
          }
        })
      },
      { permission }
    )
    await fixture(page)
    await page.getByRole('button', { name: '系统通知', exact: true }).click()
    expect(
      await page.evaluate(
        () => (window as unknown as { notificationTestState: { prompts: number } }).notificationTestState.prompts
      )
    ).toBe(0)
    if (permission === 'default') {
      await page.getByRole('button', { name: '启用系统通知', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('已获得浏览器通知权限')
      const sent = await page.evaluate(async () => {
        const win = window as unknown as { hermesDesktop: { notify: (arg: unknown) => Promise<boolean> } }
        return win.hermesDesktop.notify({ title: '测试待办', body: '待处理事项', tag: 'fixture', silent: true })
      })
      expect(sent).toBe(true)
      expect(
        await page.evaluate(
          () => (window as unknown as { notificationTestState: { prompts: number } }).notificationTestState.prompts
        )
      ).toBe(1)
    } else {
      await expect(page.getByRole('status')).toContainText(
        permission === 'denied' ? '通知已被浏览器阻止' : '不支持系统通知'
      )
      await expect(page.getByRole('button', { name: '启用系统通知', exact: true })).toHaveCount(0)
    }
  })
}
