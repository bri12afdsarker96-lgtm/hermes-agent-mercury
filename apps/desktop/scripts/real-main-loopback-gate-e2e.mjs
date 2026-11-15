import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(desktop, '../..')
const runs = path.join(repo, 'results', 'real-main-loopback-gate')
await mkdir(runs, { recursive: true })
const output = await mkdtemp(path.join(runs, 'run-'))
const userData = await mkdtemp(path.join(os.tmpdir(), 'hermes-real-main-test-'))
const requests = []
const identity = { principal_id: 'synthetic-operator', tenant_id: 'synthetic-tenant', tenant_name: '模拟企业', name: '模拟员工', role: 'operator', effective_permissions: ['*'], product_capabilities: { doudian_review: { enabled: true, status: 'LIVE' }, doudian_payment: { enabled: true, status: 'LIVE' } }, desktop_surfaces: { schema_version: 1, surfaces: {} } }
const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://127.0.0.1').pathname
  requests.push({ method: req.method, route })
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'POST' && route === '/api/login') {
    let body = ''
    for await (const chunk of req) { body += chunk; if (body.length > 4096) { res.writeHead(413).end('{}'); return } }
    let login
    try { login = JSON.parse(body) } catch { res.writeHead(400).end('{}'); return }
    if (login.name !== 'synthetic' || login.password !== 'synthetic') { res.writeHead(401).end('{}'); return }
    res.end(JSON.stringify({ token: 'synthetic-only-token', must_change_password: false })); return
  }
  if (req.method !== 'GET' || req.headers.authorization !== 'Bearer synthetic-only-token') { res.writeHead(403).end('{}'); return }
  const data = route === '/api/whoami' ? identity : route === '/api/health' ? { ok: true, auth_mode: 'synthetic' } : route === '/api/metrics' ? { alerts: [] } : { available: false, configured: false, entries: [], reminders: [], tasks: [], groups: [], staff: [] }
  res.end(JSON.stringify(data))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
Object.assign(env, { PATH: path.join(process.env.SystemRoot, 'System32'), HOME: userData, USERPROFILE: userData, APPDATA: path.join(userData, 'appdata'), LOCALAPPDATA: path.join(userData, 'localappdata'), HERMES_DESKTOP_USER_DATA_DIR: userData, HERMES_DESKTOP_ENTERPRISE_ORIGIN: `http://127.0.0.1:${server.address().port}`, HERMES_DESKTOP_BOOT_FAKE_ERROR: 'Synthetic test: backend intentionally unavailable', HERMES_DESKTOP_BOOT_FAKE_STEP_MS: '0' })
const run = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), mode: 'unpackaged-real-main-loopback-only', userData, startedAt: new Date().toISOString() }
await writeFile(path.join(output, 'run-info.json'), JSON.stringify(run, null, 2))
let app, page
try {
  app = await electron.launch({ executablePath: path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe'), args: [desktop], cwd: desktop, env, timeout: 30000 })
  page = await app.firstWindow({ timeout: 30000 })
  const settings = await app.evaluate(({ app, BrowserWindow }) => ({ disabled: app.commandLine.hasSwitch('no-sandbox'), prefs: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(), appPath: app.getAppPath() }))
  if (settings.disabled || !settings.prefs.sandbox || !settings.prefs.contextIsolation || settings.prefs.nodeIntegration) throw new Error('Unsafe renderer settings')
  if (!await page.evaluate(() => window.hermesDesktop.isLocalVerification())) throw new Error('Local verification gate not active')
  await page.getByLabel('登录账号').fill('synthetic', { timeout: 20000 })
  await page.getByLabel('登录密码').fill('synthetic')
  await page.screenshot({ path: path.join(output, '01-login.png') })
  await page.getByRole('button', { name: '登录企业工作台' }).click()
  await page.getByTestId('enterprise-client-workbench').waitFor({ timeout: 20000 })
  await page.screenshot({ path: path.join(output, '02-workbench.png') })
  const result = await page.evaluate(async () => {
    const login = await window.hermesDesktop.enterprise.loginWithPassword({ loginName: 'synthetic', password: 'synthetic', rememberPassword: false })
    if (!login.ok) return { login }
    return { login: { ok: true }, review: await window.hermesDesktop.enterprise.doudian({ sessionId: login.sessionId, action: 'capabilities' }), payment: await window.hermesDesktop.enterprise.doudian({ sessionId: login.sessionId, action: 'preparePayment', amount: '3.25', startRow: '2', maxRows: '0', mode: 'standard' }) }
  })
  if (result.review?.error !== 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE' || result.payment?.error !== 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE') throw new Error(`Unexpected gate result: ${JSON.stringify(result)}`)
  await writeFile(path.join(output, 'gate-result.json'), JSON.stringify({ result, sandbox: settings.prefs.sandbox, contextIsolation: settings.prefs.contextIsolation, appPath: settings.appPath }, null, 2))
  console.log(`PASS real main + synthetic loopback login + TD gate denial; output=${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  await writeFile(path.join(output, 'failure.txt'), String(error.stack || error))
  console.error(`FAIL real main test; evidence=${output}`)
  throw error
} finally {
  await writeFile(path.join(output, 'requests.json'), JSON.stringify(requests, null, 2))
  if (app) await app.close().catch(() => {})
  await new Promise(resolve => server.close(resolve))
}
