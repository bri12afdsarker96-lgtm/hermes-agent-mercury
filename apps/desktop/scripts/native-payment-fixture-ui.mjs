// Developer-only native UI acceptance using immutable existing source and a pinned synthetic host.
import { execFileSync, spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build as esbuild } from 'esbuild'
import { _electron as electron } from 'playwright'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(desktop, '../..')
const source = path.join(desktop, 'native-payment-fixture-ui')
const output = path.join(repo, 'results', 'native-payment-fixture-ui')
const snapshot = path.join(output, 'snapshot')
const revision = 'd5d8bb097ed4def2b44be661b7c9d13948fce370'
const fixture = process.env.HERMES_SYNTHETIC_PAYMENT_DIR
if (!fixture || !path.isAbsolute(fixture)) throw new Error('Set HERMES_SYNTHETIC_PAYMENT_DIR to the absolute synthetic fixture directory')
await mkdir(snapshot, { recursive: true })
for (const [name, file] of [['payment-page.tsx', 'apps/desktop/src/enterprise-client/payment-page.tsx'], ['doudian-host.ts', 'apps/desktop/electron/doudian-host.ts']]) {
  const bytes = execFileSync('git', ['show', `${revision}:${file}`], { cwd: repo })
  await writeFile(path.join(snapshot, name), bytes)
}
const binary = path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe')
await viteBuild({ configFile: false, root: source, base: './', cacheDir: path.join(output, 'vite-cache'), plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(desktop, 'src'), '#fixture-payment-page': path.join(snapshot, 'payment-page.tsx') }, dedupe: ['react', 'react-dom'] },
  build: { outDir: path.join(output, 'renderer'), emptyOutDir: false }, logLevel: 'warn' })
await esbuild({ entryPoints: [path.join(source, 'main.ts')], outfile: path.join(output, 'main.cjs'),
  platform: 'node', format: 'cjs', bundle: true, external: ['electron'], alias: { '#fixture-payment-host': path.join(snapshot, 'doudian-host.ts') }, logLevel: 'warning' })
await copyFile(path.join(source, 'preload.cjs'), path.join(output, 'preload.cjs'))
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]))
env.PATH = path.join(process.env.SystemRoot, 'System32')
env.HERMES_SYNTHETIC_PAYMENT_DIR = fixture

if (process.argv.includes('--open')) {
  const child = spawn(binary, [path.join(output, 'main.cjs')], { cwd: output, env, stdio: 'ignore', detached: true })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.unref()
  console.log('Opening local synthetic payment page. Only the fixed test case is enabled.')
} else {
  let probes = 0, app
  const probe = http.createServer((_req, res) => { probes++; res.end('unexpected') })
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  try {
    app = await electron.launch({ executablePath: binary, args: [path.join(output, 'main.cjs')], env, cwd: output, timeout: 30000 })
    const settings = await app.evaluate(({ app, BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
      return { disabled: app.commandLine.hasSwitch('no-sandbox'), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation }
    })
    if (settings.disabled || !settings.sandbox || !settings.contextIsolation) throw new Error('Unsafe Electron renderer settings')
    const page = await app.firstWindow()
    await page.getByText('本机模拟付款验收 · 假 Screen / Excel · 不连接店铺 · 不发生真实付款').waitFor()
    const blockedWindow = await page.evaluate(() => window.syntheticPayment.request({ action: 'openPayment' }))
    const blockedLogin = await page.evaluate(() => window.syntheticPayment.request({ action: 'shopLoginStart', shopId: 'b'.repeat(32) }))
    if (blockedWindow?.error !== 'SYNTHETIC_ACTION_BLOCKED' || blockedLogin?.error !== 'SYNTHETIC_ACTION_BLOCKED') throw new Error('Forbidden action accepted')
    await page.evaluate(async port => { try { await fetch(`http://127.0.0.1:${port}/synthetic`) } catch {} }, probe.address().port)
    if (probes) throw new Error('Unexpected renderer network access')
    const noOriginalWindow = async () => {
      const state = await app.evaluate(({ BrowserWindow }) => ({ count: BrowserWindow.getAllWindows().length, pid: process.env.HERMES_SYNTHETIC_HOST_PID }))
      if (state.count !== 1 || !/^\d+$/.test(state.pid || '')) throw new Error(`Unexpected window/host state ${JSON.stringify(state)}`)
      const handle = execFileSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${state.pid} -ErrorAction Stop).MainWindowHandle.ToInt64()`], { encoding: 'utf8' }).trim()
      if (handle !== '0') throw new Error(`Synthetic host exposed a native window: ${handle}`)
    }
    await page.getByRole('button', { name: '选择工作簿' }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: '选择工作簿' }).click()
    await page.getByText('synthetic.xlsx').waitFor()
    await noOriginalWindow()
    await page.getByLabel('金额', { exact: true }).fill('3.25')
    await page.getByLabel('起始行', { exact: true }).fill('2')
    await page.screenshot({ path: path.join(output, '01-payment-ready.png') })
    await page.getByRole('button', { name: '检查并准备' }).click()
    await page.getByRole('button', { name: '确认开始打款' }).waitFor({ state: 'visible' })
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.includes('确认开始打款') && !button.disabled), null, { timeout: 15000 })
    await noOriginalWindow()
    await page.screenshot({ path: path.join(output, '02-payment-confirm.png') })
    await page.getByRole('button', { name: '确认开始打款' }).click()
    await page.getByText('打款已暂停，需人工核验。', { exact: true }).waitFor({ timeout: 20000 })
    const replay = await page.evaluate(() => window.syntheticPayment.request({ action: 'startPayment', taskId: 'a'.repeat(32) }))
    if (replay?.error !== 'SYNTHETIC_ACTION_BLOCKED') throw new Error('Synthetic payment replay was not blocked')
    await noOriginalWindow()
    await page.screenshot({ path: path.join(output, '03-payment-paused-review.png') })
    const root = await app.evaluate(() => process.env.HERMES_SYNTHETIC_PAYMENT_ROOT)
    const calls = (await readFile(path.join(root, 'fixture', 'calls.txt'), 'utf8')).trim().split(/\r?\n/)
    const saved = JSON.parse(await readFile(path.join(root, 'fixture', 'persisted.json'), 'utf8'))
    const auditPath = path.join(root, 'request-audit.jsonl')
    const audit = (await readFile(auditPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
    if (JSON.stringify(calls) !== JSON.stringify(['confirm', 'second-confirm']) || !saved['2']?.includes('需人工核验') || saved['3'] !== undefined ||
        audit.some(entry => entry.channel === 'host' && entry.method === 'openPayment') || audit.filter(entry => entry.channel === 'host' && entry.method === 'startPayment').length !== 1) {
      throw new Error(`Synthetic evidence mismatch: ${JSON.stringify({ calls, saved, audit })}`)
    }
    for (const [from, to] of [[auditPath, 'request-audit.jsonl'], [path.join(root, 'fixture', 'calls.txt'), 'synthetic-calls.txt'], [path.join(root, 'fixture', 'persisted.json'), 'synthetic-persisted.json']]) await copyFile(from, path.join(output, to))
    console.log(`PASS: synthetic payment paused_review; real PaymentPage and TD Workflow; no original window; sandbox=${settings.sandbox}`)
    console.log(`Evidence: ${output}`)
  } finally {
    if (app) await app.close()
    await new Promise(resolve => probe.close(resolve))
  }
}
