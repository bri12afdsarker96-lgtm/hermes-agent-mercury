import fs from 'node:fs'
import path from 'node:path'
import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { buildAppEnv, createSandbox } from './fixtures'
import pkg from '../package.json' with { type: 'json' }

// Exercise the shipped renderer, preload, IPC and Chromium persistence through
// a whole process restart. Server fixtures commit before dropping the response.
test('a packaged receipt retries the original request after a whole restart', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows enterprise installer acceptance')
  test.setTimeout(120_000)
  const sandbox = createSandbox('financial-restart', { initialWindowSize: { width: 1280, height: 900 } })
  const ledgerPath = path.join(sandbox.root, 'server-receipts.json')
  fs.writeFileSync(ledgerPath, JSON.stringify({ attempts: [], receipts: {} }))
  const env = buildAppEnv(sandbox, { HERMES_DESKTOP_BOOT_FAKE: '1' })
  delete env.HERMES_DESKTOP_HERMES_ROOT
  delete env.HERMES_DESKTOP_DEV_SERVER
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await _electron.launch({
      executablePath: path.resolve('release', pkg.version, 'win-unpacked', 'HermesEnterpriseAssistant.exe'),
      args: ['--disable-gpu', '--no-sandbox'],
      env
    })
    const page = await app.firstWindow()
    expect(page.url()).toContain('app.asar')
    await app.evaluate(({ ipcMain }, ledgerFile) => {
      const fs = process.getBuiltinModule('fs')
      const identity = {
        principal_id: 'fixture-admin',
        tenant_id: 'fixture-tenant',
        name: '恢复验收管理员',
        role: 'tenant_admin',
        effective_permissions: ['*'],
        product_capabilities: { enterprise_chat: { enabled: true, status: 'LIVE' } },
        desktop_surfaces: { schema_version: 1, surfaces: { workflows: { available: true } } }
      }
      const row = {
        source_id: 'restart-receivable',
        followup_id: 'restart-receivable',
        source_type: 'receivable_followup',
        business_subject: '重启恢复验收应收款',
        owner_principal_id: 'fixture-admin',
        owner_name: '恢复验收管理员',
        status: 'open',
        task_status: 'pending',
        amount: '100.00',
        currency: 'CNY',
        expected_receive_date: '2026-10-20',
        receivable_date: '2026-10-01',
        overdue: false,
        allowed_actions: ['received', 'reschedule', 'close']
      }
      for (const name of ['auto-connect', 'request', 'remembered-login'])
        ipcMain.removeHandler(`hermes:enterprise:${name}`)
      ipcMain.handle('hermes:enterprise:auto-connect', () => ({
        ok: true,
        sessionId: 'fixture-session',
        baseUrl: 'http://127.0.0.1:49152'
      }))
      ipcMain.handle('hermes:enterprise:remembered-login', () => ({
        rememberPassword: false,
        loginName: '',
        password: ''
      }))
      ipcMain.handle('hermes:enterprise:request', (_event, request) => {
        const query = new URL(request.path, 'http://fixture.invalid')
        const state = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))
        const receipts = Object.values(state.receipts) as {
          amount: string
          idempotency_key: string
          received_at: string
        }[]
        const received = receipts.reduce((sum, receipt) => sum + Number(receipt.amount), 0)
        const current = { ...row, received_amount: received.toFixed(2), remaining_amount: (100 - received).toFixed(2) }
        let data: unknown
        switch (query.pathname) {
          case '/api/whoami':
            data = identity
            break
          case '/api/health':
            data = { ok: true, auth_mode: 'strict' }
            break
          case '/api/metrics':
            data = { alerts: [] }
            break
          case '/api/operations-overview':
            data = { groups: [], knowledge: {}, reminders: [], scope: {}, staff: [], summary: {} }
            break
          case '/api/business-followups':
            data = query.searchParams.has('followup_id')
              ? { followup: current }
              : { available: true, followups: [current] }
            break
          case '/api/reminder-center':
            data = { available: true, tasks: [current] }
            break
          case '/api/receivables-report':
            data = {
              available: true,
              as_of_date: '2026-10-04',
              page: 1,
              page_size: 25,
              total: 1,
              followups: [current],
              daily: [],
              customers: [],
              scope_options: { current_principal_id: 'fixture-admin', groups: [], people: [] },
              summary_totals: []
            }
            break
          case '/api/business-followup-history':
            data = {
              available: true,
              can_record_receipt: true,
              can_correct_receipt: false,
              can_add_note: false,
              can_write_off: false,
              transfer_targets: [],
              received_amount: current.received_amount,
              remaining_amount: current.remaining_amount,
              receipts: receipts.map(receipt => ({
                ...receipt,
                receipt_id: receipt.idempotency_key,
                event_type: 'receipt_recorded',
                reversed: false
              })),
              history: []
            }
            break
          case '/api/receivable-receipt-action': {
            const body = request.body
            state.attempts.push(body)
            const existing = state.receipts[body.idempotency_key]
            if (existing && JSON.stringify(existing) !== JSON.stringify(body))
              throw new Error('Idempotency facts changed')
            state.receipts[body.idempotency_key] = body
            fs.writeFileSync(ledgerFile, JSON.stringify(state))
            if (!existing) return { kind: 'error', code: 'network', status: 0, message: 'committed, response lost' }
            data = { ok: true }
            break
          }
          default:
            data = {
              available: false,
              entries: [],
              groups: [],
              reminders: [],
              tasks: [],
              occurrences: [],
              outbox: [],
              models: [],
              personas: []
            }
        }
        return { kind: 'ok', data }
      })
    }, ledgerPath)
    await page.reload()
    await expect(page.getByTestId('enterprise-client-workbench')).toBeVisible()
    await page
      .getByRole('navigation', { name: '企业客户端主导航' })
      .getByRole('button', { name: /应收款跟进/ })
      .click()
    await page
      .getByRole('row')
      .filter({ hasText: '重启恢复验收应收款' })
      .first()
      .getByRole('button', { name: '查看与处理', exact: true })
      .click()
    return page
  }
  try {
    const first = await launch()
    await first.getByLabel('本次收款金额', { exact: true }).fill('20.00')
    await first.getByLabel('实际到账时间', { exact: true }).fill('2026-01-01T09:00')
    await first.getByRole('button', { name: '确认登记收款', exact: true }).click()
    await expect(first.getByRole('button', { name: '重试原提交', exact: true })).toBeVisible()
    const pending = await first.evaluate(() =>
      Object.entries(localStorage).filter(([key]) => key.startsWith('hermes:receivable-pending:'))
    )
    expect(pending).toHaveLength(1)
    await app!.close()
    app = undefined
    const second = await launch()
    // Tab-only storage did not survive; recovery comes from the durable journal.
    expect(
      await second.evaluate(() =>
        Object.keys(sessionStorage).filter(key => key.startsWith('hermes:receivable-pending:'))
      )
    ).toEqual([])
    await second.getByRole('button', { name: '重试原提交', exact: true }).click()
    await expect(second.getByText('已保存到服务端。', { exact: true })).toBeVisible()
    const state = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    expect(state.attempts).toHaveLength(2)
    expect(state.attempts[1]).toEqual(state.attempts[0])
    expect(Object.keys(state.receipts)).toHaveLength(1)
    expect(
      Object.values(state.receipts).reduce(
        (sum: number, receipt: unknown) => sum + Number((receipt as { amount: string }).amount),
        0
      )
    ).toBe(20)
    expect(
      await second.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('hermes:receivable-pending:')))
    ).toEqual([])
    fs.copyFileSync(ledgerPath, info.outputPath('restart-receipt-evidence.json'))
    await second.screenshot({ path: info.outputPath('recovered-receipt.png') })
  } finally {
    await app?.close().catch(() => {})
    sandbox.cleanup()
  }
})
