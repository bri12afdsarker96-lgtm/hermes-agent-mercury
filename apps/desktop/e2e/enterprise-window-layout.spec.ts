import path from 'node:path'
import fs from 'node:fs'
import { _electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { buildAppEnv, createSandbox } from './fixtures'
import pkg from '../package.json' with { type: 'json' }

test('packaged enterprise chrome and small-window controls stay usable', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows enterprise window controls')
  const evidenceRoot = info.outputPath('layout')
  test.setTimeout(180_000)
  fs.mkdirSync(evidenceRoot, { recursive: true })
  const sandbox = createSandbox('visual-fix-0209')
  const env = buildAppEnv(sandbox, { HERMES_DESKTOP_BOOT_FAKE: '1' })
  delete env.HERMES_DESKTOP_HERMES_ROOT
  delete env.HERMES_DESKTOP_DEV_SERVER
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  const observations: Record<string, unknown>[] = []
  const errors: string[] = []
  try {
    app = await _electron.launch({
      executablePath: path.resolve('release', pkg.version, 'win-unpacked', 'HermesEnterpriseAssistant.exe'),
      args: ['--disable-gpu', '--no-sandbox'],
      env
    })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForURL(/app\.asar/)
    await app.evaluate(({ ipcMain }) => {
      const themeLog: unknown[] = []
      ;(ipcMain as unknown as { auditThemeLog: unknown[] }).auditThemeLog = themeLog
      ipcMain.on('hermes:titlebar-theme', (_event, payload) => themeLog.push(payload))
      let connected = false
      let forceChange = false
      const identity = {
        principal_id: 'audit-admin',
        tenant_id: 'audit-tenant',
        tenant_name: '界面验收企业',
        name: '测试管理员',
        role: 'tenant_admin',
        effective_permissions: ['*'],
        product_capabilities: {
          enterprise_chat: { enabled: true, status: 'LIVE' },
          knowledge_rag: { enabled: true, status: 'LIVE' }
        },
        desktop_surfaces: {
          schema_version: 1,
          surfaces: { knowledge: { available: true }, workflows: { available: true } }
        }
      }
      const row = {
        source_id: 'audit-followup',
        followup_id: 'audit-followup',
        source_type: 'receivable_followup',
        business_subject: '测试应收款',
        owner_principal_id: 'audit-admin',
        owner_name: '测试管理员',
        status: 'open',
        task_status: 'pending',
        amount: '500.00',
        currency: 'CNY',
        received_amount: '100.00',
        remaining_amount: '400.00',
        receivable_date: '2026-10-01',
        expected_receive_date: '2026-10-10',
        overdue: false,
        allowed_actions: ['received', 'reschedule', 'cancel', 'close']
      }
      for (const name of ['auto-connect', 'disconnect', 'request', 'remembered-login', 'login'])
        ipcMain.removeHandler(`hermes:enterprise:${name}`)
      ipcMain.handle('hermes:enterprise:auto-connect', () =>
        connected
          ? { ok: true, sessionId: 'audit-session', baseUrl: 'http://127.0.0.1:49152', mustChangePassword: forceChange }
          : { ok: false, code: 'no_native_session' }
      )
      ipcMain.handle('hermes:enterprise:login', () => {
        connected = true
        return { ok: true, sessionId: 'audit-session', baseUrl: 'http://127.0.0.1:49152' }
      })
      ipcMain.handle('hermes:enterprise:disconnect', () => {
        connected = false
        return { ok: true }
      })
      ipcMain.handle('hermes:enterprise:remembered-login', () => ({
        rememberPassword: false,
        loginName: '',
        password: ''
      }))
      ipcMain.handle('hermes:audit:set-mode', (_e, mode) => {
        connected = mode !== 'login'
        forceChange = mode === 'password'
      })
      ipcMain.handle('hermes:enterprise:request', (_e, req) => {
        const route = new URL(req.path, 'http://audit.invalid').pathname
        let data: unknown
        switch (route) {
          case '/api/whoami':
            data = { ...identity, must_change_password: forceChange }
            break
          case '/api/health':
            data = { ok: true, auth_mode: 'strict' }
            break
          case '/api/metrics':
            data = { alerts: [] }
            break
          case '/api/operations-overview':
            data = {
              groups: [],
              knowledge: { pending_review: 0, published: 338 },
              knowledge_available: true,
              reminders: [],
              scope: { operator_count: 10, read_only: false },
              staff: [],
              summary: {
                today_questions: 0,
                today_answers: 0,
                today_customer_replies: 0,
                week_answers: 0,
                total_answers: 0,
                total_customer_replies: 0
              }
            }
            break
          case '/api/business-followups':
            data = new URL(req.path, 'http://audit.invalid').searchParams.has('followup_id')
              ? { followup: row }
              : { available: true, followups: [row] }
            break
          case '/api/business-followup-history':
            data = {
              available: true,
              can_record_receipt: true,
              can_correct_receipt: true,
              can_add_note: true,
              transfer_targets: [],
              received_amount: '100.00',
              remaining_amount: '400.00',
              receipts: [],
              history: []
            }
            break
          case '/api/reminder-center':
            data = { available: true, tasks: [row], wecom_direct_reminder_ready: false }
            break
          case '/api/receivables-report':
            data = {
              available: true,
              as_of_date: '2026-10-03',
              page: 1,
              page_size: 25,
              total: 1,
              followups: [row],
              daily: [],
              customers: [],
              scope_options: { current_principal_id: 'audit-admin', groups: [], people: [] },
              summary_totals: [
                {
                  currency: 'CNY',
                  due_today: '0.00',
                  unpaid: '400.00',
                  overdue: '0.00',
                  outstanding: '400.00',
                  inactive: '0.00',
                  received: '100.00',
                  receivable: '500.00'
                }
              ]
            }
            break
          case '/api/tenant-ai-models':
            data = {
              configured: true,
              models: [{ configuration_id: 'audit-model', is_default: true, model: '测试模型', provider: 'fixture' }]
            }
            break
          case '/api/tenant-ai-personas':
            data = { personas: [{ persona_id: 'customer-service', name: '智能客服', is_default: true }] }
            break
          case '/api/customer-reply-workspace':
            data = { revision: 0, workspace: null, updated_at: null }
            break
          case '/api/knowledge-uploads':
            data = { uploads: [], count: 0 }
            break
          case '/api/knowledge-pending':
            data = { pending: [] }
            break
          case '/api/knowledge-candidates':
            data = {
              candidates: [],
              permissions: ['*'],
              role: 'tenant_admin',
              principal_id: 'audit-admin',
              total: 0,
              counts: {}
            }
            break
          case '/api/knowledge-published':
            data = { published: [], entries: [] }
            break
          default:
            data = {
              available: false,
              configured: false,
              entries: [],
              groups: [],
              members: [],
              requests: [],
              uploads: [],
              reminders: [],
              tasks: [],
              personas: [],
              occurrences: [],
              outbox: []
            }
        }
        return { kind: 'ok', data }
      })
    })
    await page.reload()
    await expect(page.getByTestId('enterprise-login-root')).toBeVisible()
    const native = await app.evaluate(async ({ app, nativeImage, nativeTheme, BrowserWindow, screen }, out) => {
      const fs = process.getBuiltinModule('fs')
      const path = process.getBuiltinModule('path')
      const win = BrowserWindow.getAllWindows()[0]
      const files = [
        path.join(process.resourcesPath, 'brand-icon.ico'),
        path.join(app.getAppPath(), 'assets/brand/hermes-mark-hires.png')
      ]
      const images = []
      for (const file of files) {
        const image = nativeImage.createFromPath(file)
        const size = image.getSize()
        const bitmap = image.toBitmap()
        let nonTransparent = 0
        for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i]) nonTransparent++
        const name = path.extname(file).slice(1)
        if (!image.isEmpty()) fs.writeFileSync(path.join(out, `decoded-${name}.png`), image.toPNG())
        images.push({ file, exists: fs.existsSync(file), empty: image.isEmpty(), size, nonTransparent })
      }
      for (const size of ['small', 'normal', 'large'] as const) {
        const image = await app.getFileIcon(app.getPath('exe'), { size })
        fs.writeFileSync(path.join(out, `exe-icon-${size}.png`), image.toPNG())
      }
      return {
        version: app.getVersion(),
        exe: app.getPath('exe'),
        pid: process.pid,
        images,
        handle: win.getNativeWindowHandle().readBigUInt64LE().toString(),
        contentBounds: win.getContentBounds(),
        display: screen.getDisplayMatching(win.getBounds()).scaleFactor,
        nativeDark: nativeTheme.shouldUseDarkColors
      }
    }, evidenceRoot)
    fs.writeFileSync(path.join(evidenceRoot, 'native-icons.json'), JSON.stringify(native, null, 2))
    const capture = async (name: string) => {
      const state = await page.evaluate(() => {
        const nav = navigator as Navigator & {
          windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect }
        }
        const overlay = nav.windowControlsOverlay
        const area = overlay?.getTitlebarAreaRect()
        const update = document.querySelector('.hesc-package-update-trigger')
        const header = document.querySelector('.hesc-titlebar,.hesc-login-titlebar')
        const rect = (el: Element | null) => el?.getBoundingClientRect().toJSON() ?? null
        const controlsLeft = area?.right
        const updateRect = update?.getBoundingClientRect()
        const visible = Boolean(updateRect?.width && updateRect?.height)
        const root = document.querySelector('.hesc-root,.hesc-login')
        const clipped = Array.from(document.querySelectorAll('button,input,select,textarea'))
          .filter(el => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && (r.left < 0 || r.right > innerWidth + 1)
          })
          .map(el => ({ label: el.getAttribute('aria-label') || el.textContent?.slice(0, 60), rect: rect(el), inScrollableTable: Boolean(el.closest('.hesc-table-wrap')) }))
          .slice(0, 18)
        return {
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
          wco: overlay ? { visible: overlay.visible, area: area?.toJSON() } : null,
          header: rect(header),
          headerPadding: header ? getComputedStyle(header).padding : null,
          headerBackground: header ? getComputedStyle(header).backgroundColor : null,
          update: rect(update),
          updateLabel: update?.textContent,
          updateOverlap:
            visible && overlay?.visible && typeof controlsLeft === 'number'
              ? Math.max(0, (updateRect?.right ?? 0) - controlsLeft)
              : 0,
          documentOverflow: document.documentElement.scrollWidth - innerWidth,
          rootOverflow: root ? root.scrollWidth - root.clientWidth : null,
          clipped
        }
      })
      const chrome = await app!.evaluate(({ BrowserWindow, ipcMain, nativeTheme }) => {
        const w = BrowserWindow.getAllWindows()[0]
        return {
          bounds: w.getBounds(),
          content: w.getContentBounds(),
          maximized: w.isMaximized(),
          zoom: w.webContents.getZoomFactor(),
          nativeDark: nativeTheme.shouldUseDarkColors,
          themeLog: (ipcMain as unknown as { auditThemeLog: unknown[] }).auditThemeLog
        }
      })
      observations.push({ name, ...state, chrome })
      expect(state.updateOverlap, name).toBe(0)
      expect(state.clipped.filter(control => !control.inScrollableTable), name).toEqual([])
      expect(chrome.nativeDark, name).toBe(true)
      expect(chrome.themeLog.at(-1), name).toMatchObject({ foreground: '#ffffff' })
      const buttons = await page
        .locator('.hesc-titlebar button,.hesc-login-titlebar button')
        .evaluateAll(elements =>
          elements.map(el => ({ label: el.textContent, rect: el.getBoundingClientRect().toJSON() }))
        )
      for (let i = 0; i < buttons.length; i++)
        for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i].rect,
            b = buttons[j].rect
          expect(
            a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
            `${name}: ${buttons[i].label} / ${buttons[j].label}`
          ).toBe(true)
        }
      await page.screenshot({ path: path.join(evidenceRoot, `${name}.png`) })
      fs.writeFileSync(path.join(evidenceRoot, 'layout-observations.json'), JSON.stringify(observations, null, 2))
    }
    const resize = async (width: number, height: number, zoom = 1) => {
      await app!.evaluate(
        ({ BrowserWindow }, size) => {
          const w = BrowserWindow.getAllWindows()[0]
          w.unmaximize()
          w.webContents.setZoomFactor(size.zoom)
          w.setContentSize(size.width, size.height)
        },
        { width, height, zoom }
      )
      await page
        .waitForFunction(
          () =>
            (
              navigator as Navigator & { windowControlsOverlay?: { getTitlebarAreaRect(): DOMRect } }
            ).windowControlsOverlay?.getTitlebarAreaRect().width! > 0,
          undefined,
          { timeout: 2000 }
        )
        .catch(() => {})
      await page.evaluate(
        () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      )
    }
    for (const size of [
      { width: 1280, height: 900 },
      { width: 1024, height: 768 },
      { width: 800, height: 620 },
      { width: 400, height: 620 }
    ]) {
      await resize(size.width, size.height)
      await capture(`login-${size.width}`)
    }
    const loginRecovery = await page.evaluate(() => {
      const input = document.querySelector('input[autocomplete="username"]')
      const list = []
      let parent = input?.parentElement
      while (parent) {
        const s = getComputedStyle(parent)
        list.push({
          class: parent.className,
          tag: parent.tagName,
          overflow: s.overflow,
          scrollHeight: parent.scrollHeight,
          clientHeight: parent.clientHeight,
          scrollTop: parent.scrollTop
        })
        parent = parent.parentElement
      }
      return { input: input?.getBoundingClientRect().toJSON(), ancestors: list }
    })
    await page.mouse.move(250, 500)
    await page.mouse.wheel(0, 4000)
    await capture('login-400-after-wheel')
    expect(
      await page.getByLabel('登录账号', { exact: true }).evaluate(el => {
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= innerHeight
      })
    ).toBe(true)
    await page.getByLabel('登录账号', { exact: true }).fill('layout.fixture')
    await page.getByRole('button', { name: '客户端更新', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    fs.writeFileSync(path.join(evidenceRoot, 'login-scroll.json'), JSON.stringify(loginRecovery, null, 2))
    await resize(1280, 900)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    await expect
      .poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
      .toBe(true)
    await capture('login-maximized')
    await resize(1280, 900, 1.5)
    await capture('login-zoom150')
    await resize(400, 620, 1.5)
    await capture('login-400-zoom150')
    await resize(400, 620, 2)
    await capture('login-400-zoom200')
    await resize(1280, 900)
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('hermes:enterprise:auto-connect')
      ipcMain.handle('hermes:enterprise:auto-connect', () => ({
        ok: true,
        sessionId: 'audit-session',
        baseUrl: 'http://127.0.0.1:49152'
      }))
    })
    await page.reload()
    await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
    const nav = page.getByRole('navigation', { name: '企业客户端主导航' })
    for (const size of [
      { width: 1280, height: 900 },
      { width: 1024, height: 768 },
      { width: 800, height: 620 },
      { width: 400, height: 620 }
    ]) {
      await resize(size.width, size.height)
      await capture(`workbench-${size.width}`)
    }
    await resize(1280, 900)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    await expect
      .poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
      .toBe(true)
    await capture('workbench-maximized')
    await resize(1280, 900, 1.5)
    await capture('workbench-zoom150')
    await resize(400, 620, 1.5)
    await capture('workbench-400-zoom150')
    await resize(400, 620, 2)
    await capture('workbench-400-zoom200')
    await resize(1280, 900)
    await page.getByRole('button', { name: '客户端更新', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await capture('update-dialog-1280')
    await resize(400, 620)
    await capture('update-dialog-400')
    await page.keyboard.press('Escape')
    await resize(1280, 900)
    await page.getByRole('button', { name: '账户安全', exact: true }).click()
    await capture('account-dialog-1280')
    await resize(400, 620)
    await capture('account-dialog-400')
    await page.keyboard.press('Escape')
    for (const surface of [
      { label: /应收款跟进/, name: 'receivables' },
      { label: /提醒/, name: 'reminders' },
      { label: /企业 AI 助手/, name: 'assistant' },
      { label: /企业知识/, name: 'knowledge' }
    ]) {
      await resize(1280, 900)
      await nav.getByRole('button', { name: surface.label }).first().click()
      await capture(`${surface.name}-1280`)
      await resize(400, 620)
      await capture(`${surface.name}-400`)
      if (surface.name === 'receivables') {
        expect(
          await page.locator('.web-receivables').evaluate(el => el.getBoundingClientRect().right <= innerWidth)
        ).toBe(true)
        const widths = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.web-receivables,.web-receivables *, .hesc-page,.hesc-main'))
            .filter(el => {
              const rect = el.getBoundingClientRect()
              return rect.width > 310
            })
            .map(el => {
              const s = getComputedStyle(el)
              return {
                tag: el.tagName,
                class: el.className,
                rect: el.getBoundingClientRect().toJSON(),
                minWidth: s.minWidth,
                overflow: s.overflow,
                grid: s.gridTemplateColumns,
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth
              }
            })
        )
        fs.writeFileSync(path.join(evidenceRoot, 'receivables-widths.json'), JSON.stringify(widths, null, 2))
      }
      if (surface.name === 'assistant') {
        await page.locator('#enterprise-ai-composer').waitFor({ state: 'attached' })
        await page.mouse.move(280, 470)
        await page.mouse.wheel(0, 4000)
        await capture('assistant-400-after-wheel')
        await page.locator('#enterprise-ai-composer').fill('小窗口输入验证')
        await page.getByRole('button', { name: '提交处理', exact: true }).scrollIntoViewIfNeeded()
        expect(
          await page.getByRole('button', { name: '提交处理', exact: true }).evaluate(el => {
            const r = el.getBoundingClientRect()
            return r.top >= 0 && r.bottom <= innerHeight
          })
        ).toBe(true)
        const detail = await page.locator('#enterprise-ai-composer').evaluate(el => {
          const rows = []
          let parent = el.parentElement
          while (parent) {
            const s = getComputedStyle(parent)
            rows.push({
              class: parent.className,
              tag: parent.tagName,
              rect: parent.getBoundingClientRect().toJSON(),
              overflow: s.overflow,
              minHeight: s.minHeight,
              height: s.height,
              scrollHeight: parent.scrollHeight,
              clientHeight: parent.clientHeight,
              scrollTop: parent.scrollTop
            })
            parent = parent.parentElement
          }
          return { composer: el.getBoundingClientRect().toJSON(), ancestors: rows }
        })
        fs.writeFileSync(path.join(evidenceRoot, 'assistant-scroll.json'), JSON.stringify(detail, null, 2))
        const matrix = []
        for (const size of [
          { width: 800, height: 620 },
          { width: 1024, height: 768 },
          { width: 1280, height: 720 },
          { width: 1280, height: 900 }
        ]) {
          await resize(size.width, size.height)
          await capture(`assistant-${size.width}x${size.height}`)
          const geometry = await page.locator('#enterprise-ai-composer').evaluate(el => {
            const input = el.getBoundingClientRect()
            const container = el.closest('.hesc-agent-transcript')!.getBoundingClientRect()
            return {
              input: input.toJSON(),
              container: container.toJSON(),
              clipped: input.top >= container.bottom || input.bottom > container.bottom
            }
          })
          matrix.push({ size, geometry })
          expect(geometry.clipped, JSON.stringify(size)).toBe(false)
        }
        fs.writeFileSync(path.join(evidenceRoot, 'assistant-matrix.json'), JSON.stringify(matrix, null, 2))
      }
    }
    fs.writeFileSync(path.join(evidenceRoot, 'page-errors.json'), JSON.stringify(errors, null, 2))
    console.log(
      JSON.stringify(
        {
          icons: native,
          observations: observations.map(row => ({
            name: row.name,
            overlap: row.updateOverlap,
            overflow: row.documentOverflow,
            rootOverflow: row.rootOverflow,
            clipped: row.clipped
          })),
          errors
        },
        null,
        2
      )
    )
    expect(
      observations.filter(row => Number(row.updateOverlap) > 0).map(row => row.name),
      'Update buttons must stay outside native window controls'
    ).toEqual([])
  } finally {
    await app?.close().catch(() => {})
    sandbox.cleanup()
  }
})
