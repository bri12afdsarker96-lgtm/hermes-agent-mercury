import assert from 'node:assert/strict'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, chromium } from 'playwright'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resultRoot = path.resolve(process.argv[2])
const dataRoot = path.join('D:/HTest/hermes-customer-service', String(Date.now()))
await mkdir(resultRoot, { recursive: true })
await mkdir(dataRoot, { recursive: true })
await mkdir(path.join(dataRoot, 'electron-localprep'), { recursive: true })
await writeFile(path.join(dataRoot, 'electron-localprep/zoom-state.json'), JSON.stringify({ zoomLevel: 0 }))
const records = []
const requests = []
const pageErrors = []
const failedRequests = []
let revoked = false
let application
let browser
let page
let profileId
const identity = {
  tenant_id: 'desktop-rehearsal',
  tenant_name: '独立桌面验收企业',
  principal_id: 'review-employee',
  name: '模拟验收员工',
  role: 'operator',
  effective_permissions: ['biztask.read', 'reminder.read'],
  product_capabilities: {
    doudian_review: { enabled: true, status: 'LIVE' },
    doudian_payment: { enabled: false, status: 'DISABLED' }
  },
  desktop_surfaces: { schema_version: 1, surfaces: { assistant: { available: true } } }
}
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  requests.push({ method: request.method, path: pathname })
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (request.method === 'POST' && pathname === '/api/login') {
    for await (const _chunk of request) {
      /* Consume synthetic credentials without logging. */
    }
    response.end(JSON.stringify({ token: 'local-desktop-fixture-session', must_change_password: false }))
    return
  }
  if (request.method !== 'GET') {
    response.writeHead(405)
    response.end('{}')
    return
  }
  if (pathname === '/api/whoami') {
    response.writeHead(revoked ? 403 : 200)
    response.end(JSON.stringify(revoked ? { error: 'revoked' } : identity))
    return
  }
  if (pathname === '/api/health') {
    response.end(JSON.stringify({ ok: true, auth_mode: 'strict' }))
    return
  }
  if (pathname === '/api/metrics') {
    response.end(JSON.stringify({ alerts: [] }))
    return
  }
  if (pathname === '/api/operations-overview') {
    response.end(
      JSON.stringify({
        groups: [],
        knowledge: { pending_review: 0, published: 0 },
        knowledge_available: false,
        reminders: [],
        scope: { operator_count: 1, read_only: true },
        staff: [],
        summary: {
          today_questions: 0,
          today_answers: 0,
          today_customer_replies: 0,
          week_answers: 0,
          total_answers: 0,
          total_customer_replies: 0
        }
      })
    )
    return
  }
  response.end(
    JSON.stringify({
      available: false,
      configured: false,
      enabled: false,
      entries: [],
      groups: [],
      members: [],
      requests: [],
      uploads: [],
      reminders: [],
      tasks: [],
      personas: [],
      occurrences: [],
      outbox: [],
      bindings: [],
      shifts: [],
      alerts: [],
      summary: {},
      staff: [],
      scope: { read_only: true },
      revision: 0,
      workspace: null
    })
  )
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(55349, '127.0.0.1', resolve)
})

const record = async (step, detail = true) => {
  records.push({ step, detail, at: new Date().toISOString() })
  await writeFile(
    path.join(resultRoot, 'desktop-results.json'),
    JSON.stringify({ dataRoot, records, requests, pageErrors, failedRequests }, null, 2)
  )
  console.log(`PASS ${step} ${JSON.stringify(detail)}`)
}
const env = Object.fromEntries(
  ['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    .filter(key => process.env[key])
    .map(key => [key, process.env[key]])
)
Object.assign(env, {
  PATH: `${path.dirname(process.execPath)};${path.join(process.env.SystemRoot, 'System32')};${path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')}`,
  HERMES_HOME: path.join(dataRoot, 'hermes-home'),
  HERMES_DESKTOP_USER_DATA_DIR: path.join(dataRoot, 'electron'),
  HERMES_DESKTOP_HERMES_ROOT: path.resolve(desktop, '../..'),
  HERMES_DESKTOP_IGNORE_EXISTING: '1',
  HERMES_DESKTOP_APP_NAME: 'Hermes-Customer-Service-Rehearsal',
  HERMES_DESKTOP_BOOT_FAKE: '1',
  HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
  HERMES_DESKTOP_DEV_SERVER: 'http://127.0.0.1:55348',
  HERMES_DESKTOP_CDP_PORT: '53348',
  HERMES_DESKTOP_ENTERPRISE_ORIGIN: 'http://127.0.0.1:55349'
})

async function launch() {
  application = await _electron.launch({
    executablePath: path.join(desktop, 'node_modules/electron/dist/electron.exe'),
    args: [desktop],
    cwd: desktop,
    env,
    timeout: 45000
  })
  application.process().stderr.on('data', data => {
    void appendFile(path.join(resultRoot, 'electron-stderr.txt'), data)
  })
  await application.firstWindow()
  await application.evaluate(({ app, BrowserWindow, screen }) => {
    const configure = browserSession => {
      // The local protocol adapter uses the Fetch Headers implementation,
      // which accepts byte strings. Keep the synthetic fixture UA ASCII.
      browserSession.setUserAgent(browserSession.getUserAgent().replace(/[^\x20-\x7e]/g, ''))
      browserSession.protocol.handle('https', request => {
        const url = new URL(request.url)
        if (request.method !== 'GET') return new Response('fixture method blocked', { status: 405 })
        if (url.hostname === 'pigeon.jinritemai.com' && url.pathname === '/backstage/currentuser') {
          return new Response(JSON.stringify({ code: 0, data: { ShopId: '10001', ShopName: '独立模拟店铺' } }), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': request.headers.get('origin') ?? 'https://fxg.jinritemai.com',
              'Access-Control-Allow-Credentials': 'true'
            }
          })
        }
        return new Response(
          `<!doctype html><html lang="zh"><meta charset="utf-8"><title>${url.pathname.includes('native-second') ? '第二标签页夹具' : '独立店铺页面夹具'}</title><style>body{background:#f5f8fb;font:18px sans-serif;padding:38px;color:#183b47}h1{color:#008f89}p{line-height:1.8}</style><h1>独立模拟店铺</h1><p>这是本机 HTTPS 页面夹具，用于桌面登录容器与只读店铺识别验收。</p><p>店铺编号 10001</p><p>当前页面由本机提供。</p><a href="https://fxg.jinritemai.com/native-second?from=popup" target="_blank">在新标签页打开</a></html>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      })
      browserSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: !details.url.startsWith('https://') })
      )
    }
    app.on('session-created', configure)
    const work = screen.getPrimaryDisplay().workArea
    for (const window of BrowserWindow.getAllWindows()) {
      window.setBounds({
        x: work.x + 10,
        y: work.y + 10,
        width: Math.min(1440, work.width - 20),
        height: Math.min(1040, work.height - 20)
      })
      window.show()
    }
  })
  browser = await chromium.connectOverCDP('http://127.0.0.1:53348')
  page = browser
    .contexts()
    .flatMap(context => context.pages())
    .find(candidate => candidate.url().startsWith('http://127.0.0.1:55348'))
  assert.ok(page, 'desktop renderer is exposed on the independent CDP port')
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }))
  await loginAndOpenTools()
  await record(
    'desktop-login-and-cdp',
    await application.evaluate(({ app }) => ({
      pid: process.pid,
      userData: app.getPath('userData'),
      hermesHome: process.env.HERMES_HOME,
      version: app.getVersion()
    }))
  )
}

async function loginAndOpenTools() {
  await page.getByPlaceholder('请输入企业登录账号').waitFor({ timeout: 45000 })
  await page.getByPlaceholder('请输入企业登录账号').fill('local.review')
  await page.getByPlaceholder('请输入登录密码').fill('fixture-review-only')
  await page.getByRole('button', { name: '登录企业工作台', exact: true }).click()
  await page.getByRole('button', { name: /店铺与客服/ }).click({ timeout: 30000 })
  await page.getByRole('button', { name: '新增登录档案', exact: true }).waitFor()
}

async function waitNativePage(host = 'fxg.jinritemai.com') {
  await application.evaluate(async ({ webContents }, hostname) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        webContents
          .getAllWebContents()
          .some(contents => contents.getURL().startsWith(`https://${hostname}/`) && !contents.isLoading())
      )
        return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Native fixture page did not finish loading')
  }, host)
}

async function addRule({ name, keyword, reply, transfer = false, evaluatedClaim = false, verifyInvalid = false }) {
  await page.getByRole('button', { name: '新增规则', exact: true }).click()
  const dialog = page.getByRole('dialog')
  assert.equal(await dialog.getByLabel('优先级', { exact: true }).inputValue(), '500')
  assert.equal(await dialog.getByLabel('命中后停止处理', { exact: true }).isChecked(), true)
  await dialog.getByLabel('规则名称', { exact: true }).fill(name)
  await dialog.getByLabel('关键词', { exact: true }).fill(keyword)
  await dialog.getByLabel('回复内容', { exact: true }).fill(reply)
  await dialog.getByLabel('转人工', { exact: true }).setChecked(transfer)
  await dialog.getByLabel('已评价返款动作', { exact: true }).setChecked(evaluatedClaim)
  if (verifyInvalid) {
    await dialog.getByLabel('优先级', { exact: true }).fill('2147483648')
    await dialog.getByRole('button', { name: '保存规则', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: 'CUSTOMER_RULE_INVALID' }).waitFor()
    assert.equal(await dialog.getByLabel('规则名称', { exact: true }).inputValue(), name)
    await record('native-int32-validation-retains-dialog-input')
  }
  await dialog.getByLabel('优先级', { exact: true }).fill(transfer ? '10' : '5')
  await screenshot(transfer ? '04-manual-rule-dialog.png' : '03-reply-rule-dialog.png')
  await dialog.getByRole('button', { name: '保存规则', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

async function simulate(id, content, { timestamp = new Date().toISOString(), error = false } = {}) {
  const panel = page.getByTestId('customer-service-preview')
  await panel.getByRole('button', { name: '模拟接收消息', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('消息编号', { exact: true }).fill(id)
  await dialog.getByLabel('消息内容', { exact: true }).fill(content)
  await dialog.getByLabel('消息时间', { exact: true }).fill(timestamp)
  await dialog.getByRole('button', { name: '运行模拟', exact: true }).click()
  if (error) await dialog.getByRole('alert').waitFor()
  else await dialog.waitFor({ state: 'hidden' })
}

async function openWorkbench() {
  await page
    .getByRole('navigation', { name: '店铺与客服', exact: true })
    .getByRole('button', { name: '坐席工作台', exact: true })
    .click()
  await page
    .getByTestId('customer-service-preview')
    .getByRole('button', { name: '模拟接收消息', exact: true })
    .waitFor()
}
async function latestAction(expected) {
  const first = page.getByTestId('customer-service-preview').getByRole('listitem').first()
  await first
    .locator('code')
    .filter({ hasText: new RegExp(`^${expected}$`) })
    .waitFor()
}

async function screenshot(name) {
  await page.screenshot({ path: path.join(resultRoot, name), fullPage: false })
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth
  }))
  assert.equal(dimensions.overflow, false)
  await record(`screenshot-${name}`, dimensions)
}

async function verifyBrowserWorkspace() {
  const workspace = page.getByTestId('shop-browser-workspace')
  const tabs = workspace.getByRole('tab')
  await tabs.first().filter({ hasText: '独立店铺页面夹具' }).waitFor()
  assert.equal(await tabs.count(), 1)
  await workspace.getByRole('button', { name: '收藏当前页面', exact: true }).click()
  await workspace.getByRole('button', { name: '取消收藏当前页面', exact: true }).waitFor()
  await workspace.getByRole('button', { name: '新建文件夹', exact: true }).click()
  let dialog = page.getByRole('dialog')
  assert.equal(await dialog.getByLabel('文件夹名称', { exact: true }).inputValue(), '新文件夹')
  await dialog.getByLabel('文件夹名称', { exact: true }).fill('  原生收藏验收  ')
  await screenshot('11-bookmark-name-dialog.png')
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const folder = workspace.locator('.shop-bookmark-folder').filter({ hasText: '原生收藏验收' })
  await folder.waitFor()
  await folder.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('文件夹名称', { exact: true }).fill('工作收藏')
  await dialog.getByLabel('文件夹名称', { exact: true }).press('Enter')
  await dialog.waitFor({ state: 'hidden' })
  const bookmark = workspace.locator('.shop-bookmark-item').filter({ hasText: '独立店铺页面夹具' })
  await bookmark.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移动到文件夹', exact: true }).hover()
  await page.getByRole('menuitem', { name: '工作收藏', exact: true }).waitFor()
  await screenshot('12-bookmark-context-menu.png')
  await page.getByRole('menuitem', { name: '工作收藏', exact: true }).click()
  await workspace.locator('.shop-bookmark-folder').filter({ hasText: '工作收藏' }).getByText('(1)', { exact: false }).waitFor()
  await record('native-bookmark-create-rename-move-through-context-menu')

  const nativePage = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('https://fxg.jinritemai.com/'))
  assert.ok(nativePage)
  await nativePage.getByRole('link', { name: '在新标签页打开', exact: true }).click()
  await tabs.filter({ hasText: '第二标签页夹具' }).waitFor()
  assert.equal(await tabs.count(), 2)
  assert.equal(await tabs.filter({ hasText: '第二标签页夹具' }).getAttribute('aria-selected'), 'true')
  const sameSession = await application.evaluate(({ webContents }) => {
    const pages = webContents.getAllWebContents().filter(contents => contents.getURL().startsWith('https://fxg.jinritemai.com/'))
    return { count: pages.length, paths: [...new Set(pages.map(contents => contents.session.getStoragePath()))] }
  })
  assert.equal(sameSession.count, 2)
  assert.equal(sameSession.paths.length, 1)
  await record('native-popup-creates-active-tab-in-same-profile-session', sameSession)
  await workspace.getByRole('button', { name: '关闭标签页 第二标签页夹具', exact: true }).click()
  assert.equal(await tabs.count(), 1)
  assert.equal(await tabs.first().getAttribute('aria-selected'), 'true')
  await workspace.getByRole('button', { name: '新建标签页', exact: true }).click()
  await tabs.filter({ hasText: '新标签页' }).waitFor()
  const address = workspace.getByLabel('网址', { exact: true })
  await address.fill('fxg.jinritemai.com/native-second')
  await address.press('Enter')
  await tabs.filter({ hasText: '第二标签页夹具' }).waitFor()
  assert.equal(await address.inputValue(), 'https://fxg.jinritemai.com/native-second')
  await workspace.getByRole('button', { name: '主页', exact: true }).click()
  await tabs.filter({ hasText: '独立店铺页面夹具' }).last().waitFor()
  await workspace.getByRole('button', { name: '后退', exact: true }).click()
  await tabs.filter({ hasText: '第二标签页夹具' }).waitFor()
  await workspace.getByRole('button', { name: '前进', exact: true }).click()
  await tabs.filter({ hasText: '独立店铺页面夹具' }).last().waitFor()
  await workspace.locator('.shop-bookmark-folder').filter({ hasText: '工作收藏' }).click()
  await page.locator('.shop-bookmark-child').filter({ hasText: '独立店铺页面夹具' }).waitFor()
  await screenshot('13-bookmark-folder-popup.png')
  await page.locator('.shop-bookmark-child').filter({ hasText: '独立店铺页面夹具' }).click()
  await workspace.getByRole('button', { name: '取消收藏当前页面', exact: true }).waitFor()
  await record('native-address-navigation-history-and-folder-child-navigation')

  const folderWithChild = workspace.locator('.shop-bookmark-folder').filter({ hasText: '工作收藏' })
  await folderWithChild.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '确认删除', exact: true })
  await dialog.getByText('文件夹「工作收藏」包含 1 个收藏，确定删除吗？', { exact: true }).waitFor()
  await screenshot('14-bookmark-delete-confirm.png')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await folderWithChild.waitFor()
  const side = workspace.locator('.shop-browser-sidebar')
  assert.equal(await side.evaluate(element => Math.round(element.getBoundingClientRect().width)), 320)
  const handle = workspace.getByRole('separator', { name: '调整订单侧栏宽度', exact: true })
  const bounds = await handle.boundingBox()
  assert.ok(bounds)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 60)
  await page.mouse.down()
  await page.mouse.move(bounds.x - 40, bounds.y + 60, { steps: 5 })
  await page.mouse.up()
  assert.ok(await side.evaluate(element => element.getBoundingClientRect().width > 350))
  await workspace.getByRole('button', { name: '收起侧栏', exact: true }).click()
  assert.equal(await side.evaluate(element => Math.round(element.getBoundingClientRect().width)), 44)
  await workspace.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await record('native-nonempty-folder-delete-cancel-and-sidebar-drag-collapse')
  await screenshot('15-native-browser-tabs-layout.png')

  await workspace.getByRole('button', { name: '新建文件夹', exact: true }).click()
  await page.getByRole('dialog').getByLabel('文件夹名称', { exact: true }).fill('删除验收')
  await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click()
  await address.fill('https://fxg.jinritemai.com/native-second')
  await address.press('Enter')
  await tabs.filter({ hasText: '第二标签页夹具' }).waitFor()
  await workspace.getByRole('button', { name: '收藏当前页面', exact: true }).click()
  await workspace.locator('.shop-bookmark-item').filter({ hasText: '第二标签页夹具' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移动到文件夹', exact: true }).hover()
  await page.getByRole('menuitem', { name: '删除验收', exact: true }).click()
  await workspace.locator('.shop-bookmark-folder').filter({ hasText: '删除验收' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click()
  await workspace.locator('.shop-bookmark-folder').filter({ hasText: '删除验收' }).waitFor({ state: 'hidden' })
  await workspace.getByRole('button', { name: '收藏当前页面', exact: true }).waitFor()
  await record('native-nonempty-folder-delete-confirm-removes-children')
  const activeBeforeClose = await tabs.filter({ hasText: '第二标签页夹具' }).getAttribute('aria-selected')
  await workspace.getByRole('button', { name: '关闭标签页 独立店铺页面夹具', exact: true }).click()
  await tabs.filter({ hasText: '独立店铺页面夹具' }).waitFor({ state: 'hidden' })
  assert.equal(activeBeforeClose, 'true')
  assert.equal(await tabs.first().getAttribute('aria-selected'), 'true')
  await workspace.getByRole('button', { name: '关闭标签页 第二标签页夹具', exact: true }).click()
  await workspace.waitFor({ state: 'hidden' })
  await record('native-close-inactive-preserves-active-and-last-tab-closes-browser')
  await page.getByRole('button', { name: '打开店铺后台', exact: true }).click()
  await waitNativePage()
  await workspace.locator('.shop-bookmark-folder').filter({ hasText: '工作收藏' }).waitFor()
  assert.equal(await workspace.getByRole('tab').count(), 1)
  await record('browser-close-reopen-restores-bookmarks-and-starts-one-tab')
}

try {
  await launch()
  await screenshot('01-desktop-profiles.png')
  await page.getByRole('button', { name: '新增登录档案', exact: true }).click()
  await page.getByRole('button', { name: '打开店铺后台', exact: true }).waitFor()
  profileId = await page.locator('tr[data-selected=true]').getAttribute('data-profile-id')
  assert.ok(profileId)
  await page.getByRole('button', { name: '打开店铺后台', exact: true }).click()
  await waitNativePage()
  await page.getByRole('button', { name: '识别当前店铺', exact: true }).click()
  await page.locator('.cs-browser-section > header h2').filter({ hasText: '独立模拟店铺' }).waitFor()
  await record('native-readonly-shop-identity', { shopId: '10001', source: 'local-https-fixture' })
  const nativeState = await application.evaluate(
    async ({ webContents }, output) => {
      const contents = webContents
        .getAllWebContents()
        .find(contents => contents.getURL().startsWith('https://fxg.jinritemai.com/'))
      await contents.session.cookies.set({
        url: 'https://fxg.jinritemai.com',
        name: 'hermes_rehearsal_cookie',
        value: 'synthetic',
        secure: true,
        expirationDate: Date.now() / 1000 + 3600
      })
      await contents.session.cookies.flushStore()
      await contents.executeJavaScript(
        "localStorage.setItem('hermes-rehearsal-state', 'synthetic'); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
      )
      const image = (await contents.capturePage()).toPNG()
      if (image.length < 1000) throw new Error('Native screenshot is empty')
      process.getBuiltinModule('fs').writeFileSync(output, image)
      return { storagePath: contents.session.getStoragePath(), screenshotBytes: image.length }
    },
    path.join(resultRoot, 'native-shop-page.png')
  )
  await record('synthetic-native-session-written', nativeState)
  await verifyBrowserWorkspace()
  await page.getByRole('button', { name: '关闭登录页', exact: true }).click()
  await page.getByRole('button', { name: '规则与人工待办', exact: true }).click()
  await page.getByRole('button', { name: '新增规则', exact: true }).waitFor()
  await screenshot('02-customer-service-empty.png')
  await record('initial-desktop-entry', { profileId })
  await addRule({ name: '问候回复', keyword: '你好', reply: '您好，这是本机模拟回复。', verifyInvalid: true })
  await addRule({
    name: '人工处理',
    keyword: '人工',
    reply: '已经登记人工待办。',
    transfer: true,
    evaluatedClaim: true
  })
  await screenshot('04b-native-rules-table.png')
  await openWorkbench()
  await simulate('hello-first', '你好')
  await latestAction('send_message')
  await record('rule-to-simulated-reply')
  await simulate('handoff-first', '请转人工')
  await latestAction('process_evaluated_claim')
  const queue = page.getByTestId('customer-service-preview')
  assert.equal(await queue.getByRole('button', { name: '标记已处理', exact: true }).count(), 1)
  await record('rule-to-human-task-and-local-claim-record')
  await simulate('handoff-first', '请转人工')
  await page.getByText('重复消息已跳过', { exact: true }).waitFor()
  assert.equal(await queue.getByRole('button', { name: '标记已处理', exact: true }).count(), 1)
  await record('duplicate-message-no-second-task')
  await page.getByRole('button', { name: '去处理', exact: true }).click()
  await waitNativePage('im.jinritemai.com')
  await page.getByRole('button', { name: '关闭登录页', exact: true }).waitFor()
  const nativeBounds = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
    return window.contentView.children
      .filter(view => view.webContents?.getURL().startsWith('https://im.jinritemai.com/'))
      .map(view => view.getBounds())
  })
  assert.equal(nativeBounds.length, 1)
  assert.ok(nativeBounds[0].height > 0)
  assert.ok(nativeBounds[0].y >= 100)
  assert.ok(nativeBounds[0].y + nativeBounds[0].height <= 972)
  await page.getByRole('button', { name: '关闭登录页', exact: true }).click()
  await openWorkbench()
  await record('native-handle-opens-isolated-feige-with-clipped-bounds', nativeBounds)
  await simulate('hello-paused', '你好')
  await latestAction('suppressed')
  await queue.getByRole('button', { name: '标记已读', exact: true }).click()
  await queue.getByRole('button', { name: '标记已处理', exact: true }).click()
  await page.getByRole('dialog', { name: '确认已处理', exact: true }).waitFor()
  await screenshot('05-complete-task-dialog.png')
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await queue.getByRole('button', { name: '标记已处理', exact: true }).count(), 1)
  await queue.getByRole('button', { name: '标记已处理', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认已处理', exact: true }).click()
  await page.getByText('等待恢复模拟', { exact: true }).first().waitFor()
  await simulate('hello-waiting', '你好')
  await latestAction('suppressed')
  await record('completion-waits-for-explicit-resume')
  await page.getByLabel('恢复原因', { exact: true }).fill('人工事项已在本机验收处理完成')
  await screenshot('06-waiting-resume.png')
  await page.getByRole('button', { name: '恢复模拟自动回复', exact: true }).click()
  await page.getByText('模拟自动回复中', { exact: true }).first().waitFor()
  await simulate('hello-resumed', '你好')
  await latestAction('send_message')
  await record('explicit-resume-restores-local-reply')
  await simulate('missing-timestamp', '你好', { timestamp: '', error: true })
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'CUSTOMER_TIMESTAMP_REQUIRED' }).waitFor()
  await page.getByRole('dialog').getByLabel('消息时间', { exact: true }).fill(new Date().toISOString())
  await page.getByRole('dialog').getByRole('button', { name: '运行模拟', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await latestAction('send_message')
  await record('missing-timestamp-rejected-and-same-id-retry-accepted')
  await screenshot('07-resumed-workflow.png')

  await page.reload()
  await loginAndOpenTools()
  await page
    .locator('tr[data-profile-id=' + JSON.stringify(profileId) + ']')
    .getByRole('button', { name: '选择', exact: true })
    .click()
  await page.getByRole('button', { name: '规则与人工待办', exact: true }).click()
  await page.getByRole('button', { name: '编辑', exact: true }).first().waitFor()
  assert.equal(await page.getByRole('button', { name: '编辑', exact: true }).count(), 2)
  await openWorkbench()
  await page.getByText('模拟自动回复中', { exact: true }).first().waitFor()
  await record('renderer-refresh-restores-rules-tasks-and-mode')
  await browser.close()
  browser = undefined
  await application.close()
  application = undefined
  await launch()
  await page
    .locator('tr[data-profile-id=' + JSON.stringify(profileId) + ']')
    .getByRole('button', { name: '选择', exact: true })
    .click()
  await page.getByRole('button', { name: '打开店铺后台', exact: true }).click()
  await waitNativePage()
  const restored = await application.evaluate(async ({ webContents }) => {
    const contents = webContents
      .getAllWebContents()
      .find(contents => contents.getURL().startsWith('https://fxg.jinritemai.com/'))
    return {
      storagePath: contents.session.getStoragePath(),
      cookiePresent: (await contents.session.cookies.get({ name: 'hermes_rehearsal_cookie' })).length === 1,
      localStorageRestored: await contents.executeJavaScript(
        "localStorage.getItem('hermes-rehearsal-state') === 'synthetic'"
      )
    }
  })
  assert.equal(restored.storagePath, nativeState.storagePath)
  assert.equal(restored.cookiePresent, true)
  assert.equal(restored.localStorageRestored, true)
  await record('full-process-restart-restores-cookie-and-local-storage', restored)
  await page.getByTestId('shop-browser-workspace').locator('.shop-bookmark-folder').filter({ hasText: '工作收藏' }).waitFor()
  assert.equal(await page.getByTestId('shop-browser-workspace').getByRole('tab').count(), 1)
  await record('full-process-restart-restores-native-bookmark-folder-and-child')
  revoked = true
  await page.getByTestId('shop-browser-workspace').waitFor({ state: 'hidden', timeout: 12000 })
  const remainingNativePages = await application.evaluate(({ webContents }) =>
    webContents.getAllWebContents().filter(contents => /^https:\/\/(fxg|im)\.jinritemai\.com\//.test(contents.getURL())).length
  )
  assert.equal(remainingNativePages, 0)
  await record('revocation-disposes-native-tabs-and-clears-bookmark-view')
  revoked = false
  await page.getByRole('button', { name: '刷新档案', exact: true }).click()
  await page.locator('tr[data-profile-id=' + JSON.stringify(profileId) + ']').getByRole('button', { name: '选择', exact: true }).click()
  await page.getByRole('button', { name: '打开店铺后台', exact: true }).click()
  await waitNativePage()
  await page.getByRole('button', { name: '关闭登录页', exact: true }).click()
  await page.getByRole('button', { name: '规则与人工待办', exact: true }).click()
  await page.getByRole('button', { name: '编辑', exact: true }).first().waitFor()
  assert.equal(await page.getByRole('button', { name: '编辑', exact: true }).count(), 2)
  await openWorkbench()
  await page.getByText('模拟自动回复中', { exact: true }).first().waitFor()
  await record('full-process-restart-restores-business-state')

  revoked = true
  await page.getByTestId('customer-service-preview').getByRole('button', { name: '刷新', exact: true }).click()
  await page
    .getByTestId('customer-service-preview')
    .getByRole('alert')
    .filter({ hasText: 'SHOP_PROFILE_ACCESS_UNAVAILABLE' })
    .waitFor()
  assert.equal(await page.getByRole('button', { name: '运行模拟', exact: true }).count(), 0)
  await screenshot('08-revoked-access.png')
  await record('authoritative-revocation-clears-business-view')
  revoked = false
  await page.getByTestId('customer-service-preview').getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('模拟自动回复中', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '原生代码依据与待确认项', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await screenshot('09-native-evidence-and-limits.png')
  assert.equal(pageErrors.length, 0)
  assert.equal(
    requests.some(request => request.method !== 'GET' && request.path !== '/api/login'),
    false
  )
  await record('no-platform-message-or-payment-writes', {
    enterpriseWrites: requests.filter(request => request.method !== 'GET').map(request => request.path),
    pageErrors
  })
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('navigation', { name: '店铺与客服', exact: true }).getByRole('button', { name: '坐席工作台', exact: true }).focus()
  await screenshot('10-latest-desktop-workspace.png')
  await page.getByRole('navigation', { name: '店铺与客服', exact: true }).getByRole('button', { name: '店铺管理', exact: true }).click()
  await page.getByRole('button', { name: '打开店铺后台', exact: true }).click()
  await waitNativePage()
  await page.getByTestId('shop-browser-workspace').locator('.shop-bookmark-folder').filter({ hasText: '工作收藏' }).waitFor()
  await screenshot('16-latest-native-browser-desktop.png')
  if (process.argv.includes('--keep-open')) {
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
      window.show()
      window.focus()
    })
  }
} catch (error) {
  console.error(error)
  if (page)
    await writeFile(path.join(resultRoot, 'failure-dom.txt'), await page.locator('body').innerText()).catch(() => {})
  if (page) await page.screenshot({ path: path.join(resultRoot, 'failure.png') }).catch(() => {})
  await writeFile(path.join(resultRoot, 'failure.txt'), String(error.stack ?? error))
  process.exitCode = 1
} finally {
  await writeFile(
    path.join(resultRoot, 'desktop-results.json'),
    JSON.stringify({ dataRoot, records, requests, pageErrors, failedRequests }, null, 2)
  )
  if (!process.argv.includes('--keep-open') || process.exitCode) {
    if (browser) await browser.close().catch(() => {})
    if (application) await application.close().catch(() => {})
    await new Promise(resolve => server.close(resolve))
  }
}
if (!process.exitCode) console.log('DESKTOP_CUSTOMER_SERVICE_PASS')
if (process.argv.includes('--keep-open') && !process.exitCode) {
  console.log('ISOLATED_DESKTOP_LEFT_OPEN')
  await new Promise(resolve => application.process().once('exit', resolve))
  await new Promise(resolve => server.close(resolve))
}
