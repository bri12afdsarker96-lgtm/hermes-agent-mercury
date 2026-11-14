// Standalone local-only UI test. This is not a packaged app or a production entry point.
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
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
const source = path.join(desktop, 'native-fixture-ui')
const output = path.join(repo, 'results', 'native-fixture-ui')
const fixture = process.env.HERMES_SYNTHETIC_TD_DIR
if (!fixture || !path.isAbsolute(fixture)) throw new Error('Set HERMES_SYNTHETIC_TD_DIR to the absolute synthetic fixture directory')
const binary = path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe')
await mkdir(output, { recursive: true })
await viteBuild({ configFile: false, root: source, base: './', cacheDir: path.join(output, 'vite-cache'), plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(desktop, 'src') }, dedupe: ['react', 'react-dom'] },
  build: { outDir: path.join(output, 'renderer'), emptyOutDir: false }, logLevel: 'warn' })
await esbuild({ entryPoints: [path.join(source, 'main.ts')], outfile: path.join(output, 'main.cjs'),
  platform: 'node', format: 'cjs', bundle: true, external: ['electron'], logLevel: 'warning' })
await copyFile(path.join(source, 'preload.cjs'), path.join(output, 'preload.cjs'))

// Keep the test process free of inherited enterprise credentials and endpoints.
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]))
env.PATH = path.join(process.env.SystemRoot, 'System32')
env.HERMES_SYNTHETIC_TD_DIR = fixture
if (process.argv.includes('--open')) {
  const child = spawn(binary, [path.join(output, 'main.cjs')], { cwd: output, env, stdio: 'ignore', detached: true })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.unref()
  console.log('Opening the synthetic Electron review window on this computer.')
} else {
  let probes = 0
  const probe = http.createServer((_req, res) => { probes++; res.end('unexpected') })
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  let app
  try {
    app = await electron.launch({ executablePath: binary, args: [path.join(output, 'main.cjs')], env, cwd: output, timeout: 30000 })
    const settings = await app.evaluate(({ app, BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
      return { disabled: app.commandLine.hasSwitch('no-sandbox'), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation }
    })
    if (settings.disabled || !settings.sandbox || !settings.contextIsolation) throw new Error(`Unsafe renderer settings: ${JSON.stringify(settings)}`)
    const page = await app.firstWindow()
    await page.getByText('本机合成验收 · 测试数据 · 不连接店铺 · 付款不可用').waitFor()
    await page.getByRole('option', { name: '合成店铺 (TEST-ONLY)' }).waitFor({ state: 'attached', timeout: 15000 })
    const blocked = await page.evaluate(async () => window.syntheticReview.request({ action: 'openPayment' }))
    if (blocked?.error !== 'SYNTHETIC_ACTION_BLOCKED') throw new Error('Payment action was not blocked')
    const login = await page.evaluate(async () => window.syntheticReview.request({ action: 'shopLoginStart', shopId: 'b'.repeat(32) }))
    if (login?.error !== 'SYNTHETIC_ACTION_BLOCKED') throw new Error('Shop login was not blocked')
    if (!(await page.getByRole('button', { name: '店铺管理' }).isDisabled())) throw new Error('Shop management should be disabled')
    const port = probe.address().port
    await page.evaluate(async port => { try { await fetch(`http://127.0.0.1:${port}/synthetic`) } catch {} }, port)
    if (probes !== 0) throw new Error('Unexpected renderer network access')
    await page.screenshot({ path: path.join(output, '01-synthetic-ready.png') })
    await page.getByRole('combobox', { name: '店铺' }).selectOption('b'.repeat(32))
    await page.getByRole('button', { name: '选择工作簿副本' }).click()
    await page.getByText('synthetic-review.xlsx').waitFor()
    await page.getByRole('button', { name: '检查待回填表格' }).click()
    await page.getByRole('button', { name: '确认截图并回填' }).waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(output, '02-synthetic-confirm.png') })
    await page.getByRole('button', { name: '确认截图并回填' }).click()
    await page.getByText('任务结束，请核对已保存与跳过记录', { exact: true }).waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(output, '03-synthetic-complete.png') })
    const trace = await app.evaluate(() => process.env.HERMES_TEST_TRACE)
    const entries = (await readFile(trace, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
    if (entries.filter(entry => entry.action === 'scan').length !== 1 || entries.filter(entry => entry.action === 'review').length !== 1 || entries.some(entry => entry.action === 'payment')) {
      throw new Error(`Unexpected synthetic trace: ${JSON.stringify(entries)}`)
    }
    await copyFile(trace, path.join(output, 'synthetic-trace.jsonl'))
    console.log(`PASS: real Electron UI, sandbox=${settings.sandbox}, payment blocked, local network probe blocked, synthetic scan/review only`)
    console.log(`Screenshots: ${output}`)
    console.log(`Synthetic trace: ${trace}`)
  } finally {
    if (app) await app.close()
    await new Promise(resolve => probe.close(resolve))
  }
}
