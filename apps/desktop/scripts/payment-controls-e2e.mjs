import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { _electron as electron } from 'playwright'

// This runner bundles a test-only Electron main. Production main.ts and trust
// manifests are never changed. Controller, preload, pages, host and workflow
// are imported/compiled from the working sources. Excel and Chrome I/O are
// synthetic. The page adapter is exercised separately with poisoned chat getters.
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(desktop, '../..')
const verifyRoot = path.dirname(repo)
const require = createRequire(import.meta.url)
const sha256 = data => createHash('sha256').update(data).digest('hex')
const options = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!['--td-source', '--output-root', '--amount'].includes(key) || !process.argv[i + 1]) {
    throw new Error('Usage: node scripts/payment-controls-e2e.mjs [--td-source <TD project>] [--output-root <results>] [--amount <yuan>]')
  }
  options.set(key, key === '--amount' ? process.argv[i + 1] : path.resolve(process.argv[i + 1]))
}
const amountOverride = options.get('--amount')
if (amountOverride !== undefined && (!/^\d+(?:\.\d{1,2})?$/.test(amountOverride) || !Number.isFinite(Number(amountOverride)) || Number(amountOverride) <= 0)) {
  throw new Error('--amount must be a positive yuan amount with at most two decimal places')
}
if (process.platform !== 'win32') throw new Error('This smoke test requires Windows and .NET Framework')
const td = options.get('--td-source') ?? path.join(verifyRoot, 'td-feige-search-wait-20261115',
  '客户定制', '早鸟Ai专用版', '代码仓', '01_外呼截图系统_桌面工具')
const runs = options.get('--output-root') ?? path.join(verifyRoot, 'results', 'payment-controls-e2e')
await mkdir(runs, { recursive: true })
const output = await mkdtemp(path.join(runs, 'run-'))
const entries = []
const assertions = []
const screenshots = []
let activeApp
let activePage
let activeRoot
let activeGate
let activeAmount
const info = {
  startedAt: new Date().toISOString(), output, desktop, td,
  hermesHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  hermesBranch: execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim(),
  tdHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: td, encoding: 'utf8' }).trim(),
  level: 'real Electron test-main + production renderer/preload/Controller + real TD host/PaymentWorkflow.Cdp; synthetic auth, Excel and Chrome I/O; production page adapter in jsdom',
  cdpBoundary: 'PaymentCdpChromeStub replaces ChromeBrowserSession external I/O; no live Chrome or store connection',
  profileBoundary: 'Synthetic Chrome I/O has no embedded browser profile. Its capability reply advertises embeddedBrowser=0. Saved profile selection is covered by the packaged desktop acceptance.',
  productionMainCovered: false,
  productionMainLimitation: 'Production main has no fixture injection; localForeground pins a production EXE hash. Existing synthetic-shell test entry is used without changing production code.',
  syntheticOnly: true, realStoreAccess: false, realPayments: false, sourceHashes: {}, fixtureOverlay: []
}
const priorPaid = '已打款｜原有合成记录'
const searchedOrders = ['444444444444444444', '555555555555555555', '777777777777777777', '888888888888888888', '999999999999999999']
const scenarioAmounts = { '01-resume': amountOverride ?? '3.25', '03-stop': amountOverride ?? '7.50', '05-restart': amountOverride ?? '7.50' }
info.scenarioAmounts = scenarioAmounts
function log(message, data = {}) {
  const entry = { at: new Date().toISOString(), message, ...data }
  entries.push(entry)
  console.log(JSON.stringify(entry))
}
function check(condition, label) {
  assert.ok(condition, label)
  assertions.push({ at: new Date().toISOString(), label, passed: true })
  log('PASS', { label })
}
async function json(name, value) {
  await writeFile(path.join(output, name), JSON.stringify(value, null, 2))
}
async function until(probe, label, timeout = 20000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    try { last = await probe(); if (last) return last } catch (error) { last = error.message }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`)
}
function replaceOnce(source, before, after, label) {
  assert.equal(source.split(before).length, 2, `Fixture binding changed: ${label}`)
  info.fixtureOverlay.push({ label, before, after })
  return source.replace(before, after)
}

async function buildFixture() {
  const source = path.join(output, 'fixture-source')
  const sourceFiles = [
    'HermesReviewHost.cs', 'AutomationConfig.cs', 'ReviewCaptureDispatcher.cs',
    'PaymentWorkflow.cs', 'PaymentWorkflow.Cdp.cs', 'WorkbookResume.cs', 'PaymentRuleEvaluator.cs',
    'PaymentFormEvaluator.cs', 'PaymentFinalResultEvaluator.cs'
  ]
  if ((await readdir(path.join(td, 'DoudianAutomationTool'))).includes('PaymentSubmissionLedger.cs')) {
    sourceFiles.push('PaymentSubmissionLedger.cs')
  }
  await mkdir(path.join(source, 'DoudianAutomationTool'), { recursive: true })
  await mkdir(path.join(source, 'tests'), { recursive: true })
  for (const name of sourceFiles.map(name => `DoudianAutomationTool/${name}`).concat([
    'tests/Test-PaymentHostEngine.ps1', 'tests/PaymentHostEngineTests.cs',
    'tests/HermesHostIsolationTests.cs', 'tests/PaymentWorkflowFixture.cs', 'tests/PaymentCdpChromeStub.cs'
  ])) {
    let bytes = await readFile(path.join(td, name))
    info.sourceHashes[`td/${name}`] = sha256(bytes)
    if (name === 'tests/PaymentWorkflowFixture.cs') {
      let text = bytes.toString('utf8')
      text = replaceOnce(text,
        'return Fixture.Book; }',
        'if (File.Exists(Fixture.StatePath)) Fixture.Reload(); Fixture.Trace("open", new { path = path, readonlyMode = false }); return Fixture.Book; }',
        'External Excel adapter reloads column D from its persisted JSON on open')
      text = replaceOnce(text,
        'public object OpenWorkbookReadOnly(string path) { throw new Exception("unexpected read-only open"); }',
        'public object OpenWorkbookReadOnly(string path) { var book = OpenWorkbook(path); Fixture.Trace("readonly-open", new { path = path }); return book; }',
        'Read-only Excel adapter supports the production preflight scanner')
      text = replaceOnce(text,
        '((FakeSheet)sheet).Results[row] = value; Fixture.Events.Add("write:" + row + ":" + value);',
        '((FakeSheet)sheet).Results[row] = value; Fixture.Trace("write", new { row = row, column = col, value = value }); Fixture.Events.Add("write:" + row + ":" + value);',
        'Record actual column D writes at the external I/O boundary')
      text = replaceOnce(text,
        'File.WriteAllText(Fixture.StatePath, json);',
        'File.WriteAllText(Fixture.StatePath, json); Fixture.Trace("save", new { cells = Fixture.Saved.ToDictionary(x => x.Key.ToString(), x => x.Value) });',
        'Record real fixture persistence')
      text = replaceOnce(text,
        'public void OpenOrActivateFeigeWindow() { Fixture.Events.Add("fake-window"); }',
        'public void OpenOrActivateFeigeWindow() { throw new Exception("Desktop transport is forbidden in this CDP fixture"); }',
        'Reject accidental screen transport at the synthetic I/O boundary')
      const fields = text.match(/internal static string WorkbookPath, StatePath(?:, LedgerDirectory)?;/)?.[0]
      assert.ok(fields, 'Missing existing payment fixture paths')
      text = replaceOnce(text,
        fields,
        'internal static void Trace(string kind, object data) { File.AppendAllText(Path.Combine(Path.GetDirectoryName(StatePath), "io-events.jsonl"), new JavaScriptSerializer().Serialize(new { at = DateTime.UtcNow.ToString("o"), kind = kind, data = data }) + "\\n"); }\n        ' + fields,
        'Append test I/O evidence without altering the production record format')
      bytes = Buffer.from(text)
    }
    if (name === 'tests/PaymentHostEngineTests.cs') {
      let text = bytes.toString('utf8')
      const before = [
        'Scan = (config, log, cancel) => new WorkbookResumeSummary { Pending = 1 }',
        'Scan = (config, log, cancel) => { config.PaymentLedgerDirectory = PaymentFixture.LedgerDirectory; return new WorkbookResumeSummary { Pending = 1 }; }'
      ].find(candidate => text.includes(candidate))
      assert.ok(before, 'Missing existing preflight fixture seam')
      const after = before.replace('new WorkbookResumeSummary { Pending = 1 }', 'WorkbookResumeInspector.Scan(config, true, log, cancel)')
      info.fixtureOverlay.push({ label: 'Replace synthetic preflight summary with the production WorkbookResumeInspector', before,
        after })
      text = text.replaceAll(before, after)
      text = replaceOnce(text, 'HermesReviewHost.Run();', 'PaymentControlsCdpFixture.Start(); HermesReviewHost.Run();',
        'Install the upstream synthetic Chrome boundary before the real host pipe starts')
      bytes = Buffer.from(text)
    }
    if (name === 'tests/Test-PaymentHostEngine.ps1') {
      let text = bytes.toString('utf8')
      text = replaceOnce(text, '& $compiler /nologo /utf8output /target:exe',
        '& $compiler /nologo /utf8output /langversion:5 "/resource:$source\\payment-cdp-resource.js,DoudianAutomationTool.Assets.ReviewCapture.feige-payment.js" /target:exe',
        'Embed the CDP stub resource under the production logical name')
      text = replaceOnce(text, '(Join-Path $PSScriptRoot \'PaymentHostEngineTests.cs\') $hostStubFile',
        '(Join-Path $PSScriptRoot \'PaymentHostEngineTests.cs\') (Join-Path $PSScriptRoot \'PaymentCdpChromeStub.cs\') (Join-Path $PSScriptRoot \'PaymentControlsCdpFixture.cs\') $hostStubFile',
        'Compile the upstream Chrome stub and the controls fixture alongside real TD sources')
      bytes = Buffer.from(text)
    }
    await writeFile(path.join(source, name), bytes)
  }
  const controlsFixture = await readFile(path.join(desktop, 'scripts/fixtures/payment-controls-cdp.cs'))
  info.sourceHashes['desktop/scripts/fixtures/payment-controls-cdp.cs'] = sha256(controlsFixture)
  await writeFile(path.join(source, 'tests/PaymentControlsCdpFixture.cs'), controlsFixture)
  await writeFile(path.join(source, 'payment-cdp-resource.js'), '/* Payment CDP integration resource fixture */')
  const fixture = path.join(output, 'pipe-build')
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(source, 'tests', 'Test-PaymentHostEngine.ps1'), '-BuildPipeDirectory', fixture],
  { cwd: source, encoding: 'utf8', windowsHide: true, timeout: 120000 })
  await writeFile(path.join(output, 'fixture-build.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  assert.equal(result.status, 0, `Fixture compilation failed: ${result.stderr || result.stdout}`)
  const module = path.join(output, 'module')
  await mkdir(module)
  const files = {}
  for (const [from, to] of [['PaymentHostEngine.exe', '外呼订单自动化.exe'], ['Newtonsoft.Json.dll', 'Newtonsoft.Json.dll']]) {
    await copyFile(path.join(fixture, from), path.join(module, to))
    files[to] = sha256(await readFile(path.join(module, to)))
  }
  // This is an ephemeral fixture manifest, consumed by the real verifier. The
  // staged production module and its trust contract are never modified.
  await writeFile(path.join(module, 'manifest.json'), JSON.stringify({ protocol: 1,
    integration: 'hermes-review-v1', version: '1.0.54', files }, null, 2))
  info.fixtureManifest = { root: module, files }
  log('fixture built', { module, files })
  return module
}

async function verifyPageAdapter() {
  const source = path.join(output, 'dom-source')
  const asset = 'DoudianAutomationTool/Assets/ReviewCapture/feige-payment.js'
  await mkdir(path.join(source, path.dirname(asset)), { recursive: true })
  await mkdir(path.join(source, 'tests'), { recursive: true })
  const pageScript = await readFile(path.join(td, asset))
  const upstreamTest = await readFile(path.join(td, 'tests/feige-payment.test.cjs'))
  const proof = await readFile(path.join(desktop, 'scripts/fixtures/payment-controls-dom-proof.cjs'))
  info.sourceHashes[`td/${asset}`] = sha256(pageScript)
  info.sourceHashes['td/tests/feige-payment.test.cjs'] = sha256(upstreamTest)
  info.sourceHashes['desktop/scripts/fixtures/payment-controls-dom-proof.cjs'] = sha256(proof)
  await writeFile(path.join(source, asset), pageScript)
  const test = path.join(source, 'tests/feige-payment.test.cjs')
  await writeFile(test, Buffer.concat([upstreamTest, Buffer.from('\n'), proof]))
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=payment controls runner emits measured DOM contract evidence', test], { cwd: source, encoding: 'utf8', windowsHide: true,
    timeout: 60000, env: { ...process.env, NODE_PATH: path.dirname(path.dirname(require.resolve('jsdom/package.json'))),
      PAYMENT_CONTROLS_DOM_EVIDENCE: path.join(output, 'dom-evidence.json') } })
  await writeFile(path.join(output, 'dom-tests.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  assert.equal(result.status, 0, `Page adapter tests failed: ${result.stderr || result.stdout}`)
  info.domEvidence = JSON.parse(await readFile(path.join(output, 'dom-evidence.json'), 'utf8'))
  check(info.domEvidence.cases.length === 8 && info.domEvidence.chatReads === 0,
    'production page adapter verifies exact records, manual compensation amounts and measured chatReads=0')
}

async function buildApp(module) {
  for (const name of ['electron/doudian-host.ts', 'electron/doudian-types.ts', 'electron/preload.ts',
    'src/enterprise-client/payment-page.tsx', 'synthetic-shell-test/renderer.tsx', 'scripts/payment-controls-e2e.mjs']) {
    info.sourceHashes[`desktop/${name}`] = sha256(await readFile(path.join(desktop, name)))
  }
  await viteBuild({ configFile: false, root: path.join(desktop, 'synthetic-shell-test'), base: './',
    cacheDir: path.join(output, 'vite-cache'), plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.join(desktop, 'src') }, dedupe: ['react', 'react-dom'] },
    build: { outDir: path.join(output, 'renderer'), emptyOutDir: false }, logLevel: 'warn' })
  const mainSource = `
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { appendFileSync, readFileSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DoudianController, DoudianHost, verifiedDoudianExecutable, assertDoudianCapability, doudianScope } from ${JSON.stringify(path.join(desktop, 'electron/doudian-host.ts'))}
const root = process.env.HERMES_PAYMENT_PIPE_ROOT
if (!root || path.dirname(root).toLowerCase() !== process.env.TEMP.toLowerCase() || !path.basename(root).startsWith('hermes-payment-pipe-')) throw new Error('Unsafe test root')
const output = ${JSON.stringify(output)}, moduleRoot = ${JSON.stringify(module)}
app.setPath('userData', path.join(root, 'electron-user-data'))
const trace = entry => appendFileSync(path.join(root, 'requests.jsonl'), JSON.stringify({ at: new Date().toISOString(), runId: process.env.HERMES_PAYMENT_PIPE_GATE, ...entry }) + '\\n')
const identity = { principal_id: 'synthetic-operator', tenant_id: 'synthetic-tenant', tenant_name: '合成烟测企业', name: '合成烟测员工', role: 'operator', effective_permissions: ['*'], product_capabilities: { doudian_review: { enabled: true, status: 'LIVE' }, doudian_payment: { enabled: true, status: 'LIVE' } }, desktop_surfaces: { schema_version: 1, surfaces: {} } }
const sessionId = 'synthetic-payment-controls-session'
let loggedIn = false, win
const children = []
const controller = new DoudianController({ platform: process.platform, root: moduleRoot,
  isCurrent: () => loggedIn,
  authorize: async action => { assertDoudianCapability(identity, action); return doudianScope('http://127.0.0.1:49152', identity) },
  chooseWorkbook: async () => path.join(root, 'fixture', 'synthetic.xlsx'),
  createHost: executable => {
    const launch = (target, args, options) => {
      const child = spawn(target, args, { ...options, env: { ...process.env, HERMES_PAYMENT_PIPE_MODE: 'cdp' } })
      children.push(child)
      trace({ channel: 'process', event: 'host-start', pid: child.pid })
      child.on('exit', (code, signal) => trace({ channel: 'process', event: 'host-exit', pid: child.pid, code, signal }))
      child.stderr.on('data', bytes => appendFileSync(path.join(root, 'host-stderr.log'), bytes))
      return child
    }
    const host = new DoudianHost(executable, launch)
    return { async request(method, params, dispatch) {
      trace({ channel: 'host', method, params, foreground: dispatch?.foreground })
      try {
        const reply = await host.request(method, params, dispatch)
        const result = method === 'capabilities' ? { ...reply, embeddedBrowser: 0 } : reply
        trace({ channel: 'host-result', method, result })
        return result
      }
      catch (error) { trace({ channel: 'host-error', method, error: error.message }); throw error }
    }, close() { host.close() } }
  }
})
const valid = event => !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
app.whenReady().then(async () => {
  // Exercise the real integrity checker against a deliberately damaged fixture.
  const negativeRoot = path.join(root, 'bad-module')
  cpSync(moduleRoot, negativeRoot, { recursive: true })
  appendFileSync(path.join(negativeRoot, 'Newtonsoft.Json.dll'), 'synthetic-corruption')
  let rejected = false
  try { await verifiedDoudianExecutable(negativeRoot) } catch (error) { rejected = error.message === 'DOUDIAN_MODULE_INVALID' }
  if (!rejected) throw new Error('Corrupt fixture accepted by integrity verifier')
  await verifiedDoudianExecutable(moduleRoot)
  trace({ channel: 'integrity', positive: 'verified', negative: 'corruption rejected' })
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    const relative = url.protocol === 'file:' ? path.relative(path.join(output, 'renderer'), fileURLToPath(url)) : ''
    const allowed = (url.protocol === 'file:' && relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) || ['data:', 'blob:'].includes(url.protocol)
    if (!allowed) trace({ channel: 'network-denied', protocol: url.protocol, host: url.host })
    callback({ cancel: !allowed })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  win = new BrowserWindow({ width: 1440, height: 1000, title: '合成订单 · 暂停继续停止烟测', webPreferences: { preload: path.join(output, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  ipcMain.handle('hermes:enterprise:auto-connect', () => ({ ok: false, code: 'no_native_session' }))
  ipcMain.handle('hermes:enterprise:remembered-login', () => null)
  ipcMain.handle('hermes:enterprise:pre-release-access-status', () => ({ enabled: false, stage: 'disabled', message: '' }))
  ipcMain.handle('hermes:enterprise:package-update-status', () => ({ state: 'idle' }))
  ipcMain.handle('hermes:enterprise:login-password', (event, payload) => {
    if (!valid(event) || payload?.loginName !== 'synthetic' || payload?.password !== 'synthetic') return { ok: false, code: 'invalid_credentials' }
    loggedIn = true; trace({ channel: 'login', synthetic: true })
    return { ok: true, sessionId, baseUrl: 'http://127.0.0.1:49152' }
  })
  ipcMain.handle('hermes:enterprise:disconnect', () => { loggedIn = false; controller.close(); return { ok: true } })
  ipcMain.handle('hermes:enterprise:request', (event, request) => {
    if (!valid(event) || !loggedIn || request?.sessionId !== sessionId || request.method !== 'GET') return { kind: 'error', status: 403 }
    const route = new URL(request.path, 'http://fixture.invalid').pathname
    trace({ channel: 'synthetic-api', route })
    return { kind: 'ok', data: route === '/api/whoami' ? identity : route === '/api/health' ? { ok: true, auth_mode: 'synthetic' } : route === '/api/metrics' ? { alerts: [] } : { available: false, configured: false, entries: [], reminders: [], tasks: [], groups: [], staff: [] } }
  })
  ipcMain.handle('hermes:enterprise:doudian', async (event, request) => {
    const allowed = ['capabilities', 'chooseWorkbook', 'preparePayment', 'startPayment', 'pausePayment', 'resumePayment', 'stop', 'status']
    if (!valid(event) || !loggedIn || request?.sessionId !== sessionId || !allowed.includes(request.action)) return { ok: false, error: 'SYNTHETIC_ACTION_BLOCKED' }
    trace({ channel: 'ui-request', request })
    const result = await controller.operate(request)
    trace({ channel: 'ui-result', action: request.action, result })
    return result
  })
  process.env.PAYMENT_CONTROLS_TEST_ROOT = root
  await win.loadURL(pathToFileURL(path.join(output, 'renderer', 'index.html')).href)
  trace({ channel: 'window', pid: process.pid, title: win.getTitle() })
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { controller.close() })
`
  const mainFile = path.join(output, 'test-main.mjs')
  await writeFile(mainFile, mainSource)
  await esbuild({ entryPoints: [mainFile], outfile: path.join(output, 'main.cjs'), bundle: true,
    platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning' })
  await esbuild({ entryPoints: [path.join(desktop, 'electron/preload.ts')], outfile: path.join(output, 'preload.cjs'),
    platform: 'node', format: 'cjs', bundle: true, external: ['electron'], logLevel: 'warning' })
}

async function shot(name) {
  const filename = `${name}.png`
  await activePage.screenshot({ path: path.join(output, filename), fullPage: true })
  screenshots.push(filename)
  const visible = await activePage.getByTestId('payment-page').innerText().catch(() => activePage.locator('body').innerText())
  await writeFile(path.join(output, `${name}.txt`), visible)
}
async function disk(root, name) {
  return JSON.parse(await readFile(path.join(root, 'fixture', name), 'utf8'))
}
async function calls(root) {
  return (await readFile(path.join(root, 'fixture', 'calls.txt'), 'utf8')).trim().split(/\r?\n/).filter(Boolean)
}
async function trace(root) {
  return (await readFile(path.join(root, 'requests.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
}
async function cdpEvents(root) {
  return (await readFile(path.join(root, 'fixture/cdp-events.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
}
async function state(root, expected) {
  return until(async () => (await trace(root)).findLast(entry => entry.runId === activeGate &&
    entry.channel === 'ui-result' && entry.action === 'status' && entry.result?.task?.state === expected), expected)
}
async function launch(root, name) {
  activeRoot = root
  activeGate = name
  activeAmount = scenarioAmounts[name]
  const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]))
  Object.assign(environment, { PATH: path.join(process.env.SystemRoot, 'System32'), HOME: root, USERPROFILE: root,
    APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'), HERMES_HOME: path.join(root, 'hermes-home'),
    HERMES_PAYMENT_PIPE_ROOT: root, HERMES_PAYMENT_PIPE_MODE: 'cdp', HERMES_PAYMENT_PIPE_GATE: activeGate,
    HERMES_PAYMENT_PIPE_AMOUNT: activeAmount })
  activeApp = await electron.launch({ executablePath: path.join(path.dirname(require.resolve('electron/package.json')), 'dist', 'electron.exe'),
    args: [path.join(output, 'main.cjs')], cwd: output, env: environment, timeout: 30000 })
  const child = activeApp.process()
  child.stdout?.on('data', bytes => entries.push({ at: new Date().toISOString(), channel: 'main-stdout', text: bytes.toString() }))
  child.stderr?.on('data', bytes => entries.push({ at: new Date().toISOString(), channel: 'main-stderr', text: bytes.toString() }))
  activePage = await activeApp.firstWindow({ timeout: 30000 })
  activePage.on('pageerror', error => entries.push({ at: new Date().toISOString(), channel: 'renderer-error', text: error.message }))
  const settings = await activeApp.evaluate(({ app, BrowserWindow }) => ({ pid: process.pid, version: process.versions.electron,
    node: process.versions.node, userData: app.getPath('userData'), title: BrowserWindow.getAllWindows()[0].getTitle(),
    noSandbox: app.commandLine.hasSwitch('no-sandbox'), prefs: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences() }))
  check(!settings.noSandbox && settings.prefs.sandbox && settings.prefs.contextIsolation && !settings.prefs.nodeIntegration,
    `${name}: real Electron sandbox and context isolation are enabled`)
  log('window started', { scenario: name, ...settings })
  await activePage.getByLabel('登录账号').fill('synthetic')
  await activePage.getByLabel('登录密码').fill('synthetic')
  await activePage.getByRole('button', { name: '登录企业工作台', exact: true }).click()
  await activePage.getByTestId('enterprise-client-workbench').waitFor({ timeout: 20000 })
  await activePage.getByRole('navigation', { name: '企业客户端主导航' }).getByRole('button', { name: '小额打款', exact: true }).click()
  await activePage.getByText('企业会话已核验，请核对准备结果后确认开始。', { exact: true }).waitFor()
  const transport = activePage.locator('select').filter({ has: activePage.locator('option[value="cdp"]') })
  await transport.selectOption('cdp')
  check(await transport.inputValue() === 'cdp', `${name}: CDP transport explicitly selected`)
  await activePage.getByRole('button', { name: '选择工作簿', exact: true }).click()
  await activePage.getByText('synthetic.xlsx', { exact: true }).waitFor()
  const amount = activePage.getByLabel('金额', { exact: true })
  const mode = activePage.locator('select').filter({ has: activePage.locator('option[value="standard"]') })
  await until(() => amount.isEnabled(), 'CDP amount is manually editable')
  await amount.fill(activeAmount)
  check(await amount.inputValue() === activeAmount &&
    await mode.inputValue() === 'standard' && await mode.isDisabled(), `${name}: manually entered CDP amount ${activeAmount} retains standard compensation mode`)
  await activePage.getByLabel('起始行', { exact: true }).fill('2')
  await activePage.getByLabel('最多行（0 表示不限）', { exact: true }).fill('0')
  await shot(`${name}-ready`)
}
async function prepare(name) {
  await activePage.getByRole('button', { name: '检查并准备', exact: true }).click()
  await until(() => activePage.getByRole('button', { name: '确认开始打款', exact: true }).isEnabled(), 'start button enabled')
  await shot(`${name}-prepared`)
  const prepared = (await trace(activeRoot)).findLast(entry => entry.runId === activeGate &&
    entry.channel === 'ui-result' && entry.action === 'preparePayment')
  check(prepared?.result?.ok === true && !!prepared.result.task?.taskId, `${name}: real preflight returns a task ID`)
  return prepared.result.task.taskId
}
async function startAndPause(root, name, expectedCalls) {
  await activePage.getByRole('button', { name: '确认开始打款', exact: true }).click()
  const gate = await until(() => disk(root, `${activeGate}.entered.json`), 'CDP confirmation response gate entered')
  check(gate.method === 'confirmation' && (await calls(root)).length === expectedCalls,
    `${name}: CDP submit persists intent before reaching the confirmation response gate`)
  await until(() => activePage.getByRole('button', { name: '暂停', exact: true }).isEnabled(), 'pause button enabled')
  await activePage.getByRole('button', { name: '暂停', exact: true }).click()
  await until(async () => (await trace(root)).some(entry => entry.runId === activeGate && entry.channel === 'ui-result' &&
    entry.action === 'pausePayment' && entry.result?.ok && entry.result.task?.state === 'pausing'), 'UI pause request accepted by real host')
  await writeFile(path.join(root, 'fixture', `${activeGate}.release`), 'release synthetic Chrome response')
  await until(() => activePage.getByRole('button', { name: '继续', exact: true }).isEnabled(), 'resume button enabled')
  await activePage.getByText('打款已暂停。', { exact: true }).waitFor()
  const paused = await state(root, 'paused')
  const before = await cdpEvents(root)
  await new Promise(resolve => setTimeout(resolve, 1700))
  assert.deepEqual(await cdpEvents(root), before, 'Paused CDP workflow must remain at the same checkpoint')
  check((await calls(root)).length === expectedCalls, `${name}: paused workflow dispatches no confirmation or next order`)
  check(await activePage.getByLabel('起始行', { exact: true }).isDisabled() &&
    await activePage.locator('select').filter({ has: activePage.locator('option[value="cdp"]') }).isDisabled(), `${name}: parameters stay locked while paused`)
  check(await activePage.getByLabel('金额', { exact: true }).inputValue() === activeAmount &&
    await activePage.getByLabel('金额', { exact: true }).isDisabled(), `${name}: paused task retains manually configured amount ${activeAmount}`)
  await shot(`${name}-paused`)
  await json(`${name}-paused-D.json`, await disk(root, 'persisted.json'))
  return paused.result.task.taskId
}
async function close(name) {
  const child = activeApp.process()
  const root = activeRoot
  const requests = await trace(root).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const pids = requests.filter(entry => entry.runId === activeGate && entry.channel === 'process' && entry.event === 'host-start').map(entry => entry.pid)
  await activeApp.close()
  check(child.exitCode !== null, `${name}: Electron exited normally`)
  await until(() => pids.every(pid => {
    try { process.kill(pid, 0); return false } catch (error) { if (error.code === 'ESRCH') return true; throw error }
  }), `${name} host exit`, 5000)
  check(true, `${name}: owned TD host processes exited`)
  activeApp = undefined
  activePage = undefined
  activeRoot = undefined
  activeGate = undefined
  activeAmount = undefined
}
async function archive(root, name) {
  for (const filename of ['requests.jsonl', 'fixture/persisted.json', 'fixture/calls.txt', 'fixture/io-events.jsonl', 'fixture/cdp-events.jsonl', 'host-stderr.log']) {
    try { await copyFile(path.join(root, filename), path.join(output, `${name}-${filename.replaceAll('/', '-')}`)) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

try {
  await verifyPageAdapter()
  const module = await buildFixture()
  await buildApp(module)
  await json('run-info.json', info)
  const resumeRoot = await mkdtemp(path.join(os.tmpdir(), 'hermes-payment-pipe-'))
  const stopRoot = await mkdtemp(path.join(os.tmpdir(), 'hermes-payment-pipe-'))
  info.scenarios = { resumeRoot, stopRoot }
  info.scenarioAmounts = scenarioAmounts

  await launch(resumeRoot, '01-resume')
  const resumeTask = await prepare('01-resume')
  check(await startAndPause(resumeRoot, '01-resume', 1) === resumeTask, 'pause retains the prepared CDP task ID')
  let saved = await disk(resumeRoot, 'persisted.json')
  check(saved['2']?.startsWith('需人工核验') && saved['2'].includes('提交处理中') &&
    saved['3'] === undefined && saved['4'] === priorPaid && saved['5'] === undefined,
  'pause persists current row D intent and preserves prior paid D4')
  await activePage.getByRole('button', { name: '继续', exact: true }).click()
  await activePage.getByText('任务已完成。', { exact: true }).waitFor({ timeout: 20000 })
  check((await state(resumeRoot, 'completed')).result.task.taskId === resumeTask, 'resume completes the same CDP task ID')
  check(await activePage.getByLabel('金额', { exact: true }).inputValue() === activeAmount,
    `same-task resume preserves the manually entered ${activeAmount} amount`)
  saved = await disk(resumeRoot, 'persisted.json')
  check(saved['2']?.startsWith('已打款') && saved['3']?.startsWith('已打款') && saved['4'] === priorPaid,
    'resume persists two synthetic CDP success results and preserves prior paid D4')
  assert.deepEqual(await calls(resumeRoot), ['submit', 'confirm', 'submit', 'confirm'])
  check(true, 'same-task resume has exactly two synthetic submissions')
  await shot('02-resume-completed')
  await close('resume')
  await archive(resumeRoot, 'resume')

  await launch(stopRoot, '03-stop')
  const stoppedTask = await prepare('03-stop')
  check(await startAndPause(stopRoot, '03-stop', 1) === stoppedTask, 'stop scenario pauses the current CDP task')
  await activePage.getByRole('button', { name: '停止', exact: true }).click()
  await activePage.getByText('任务已停止。', { exact: true }).waitFor({ timeout: 20000 })
  check((await state(stopRoot, 'stopped')).result.task.taskId === stoppedTask, 'stop terminates the current CDP task ID')
  saved = await disk(stopRoot, 'persisted.json')
  const unresolved = saved['2']
  check(unresolved?.startsWith('需人工核验') && unresolved.includes('提交处理中') && saved['3'] === undefined && saved['4'] === priorPaid,
    'stop preserves submitted intent, untouched next row and prior paid result')
  assert.deepEqual(await calls(stopRoot), ['submit'])
  await shot('04-stopped')
  await close('stop')
  await archive(stopRoot, 'stopped')

  // New Electron and TD processes reopen the same synthetic workbook. The fake
  // Excel adapter reloads persisted cells; the real preflight/policy/workflow
  // decides which rows are eligible. No state is restored by the renderer.
  await launch(stopRoot, '05-restart')
  const restartedTask = await prepare('05-restart')
  check(restartedTask !== stoppedTask, 'fresh Electron and TD processes create a new task for persisted D-column resume')
  const summary = await activePage.getByLabel('工作簿和任务状态').innerText()
  check(summary.includes('从第 3 行') && summary.includes('需人工核对、不自动重试：1'), 'restart preflight identifies D2 review and resumes at row 3')
  check(await startAndPause(stopRoot, '05-restart', 2) === restartedTask, 'restarted task pauses only the next pending order')
  await activePage.getByRole('button', { name: '继续', exact: true }).click()
  await activePage.getByText('任务已完成。', { exact: true }).waitFor({ timeout: 20000 })
  check(await activePage.getByLabel('金额', { exact: true }).inputValue() === activeAmount,
    `D-column restart and resume preserve the manually entered ${activeAmount} amount`)
  saved = await disk(stopRoot, 'persisted.json')
  check(saved['2'] === unresolved && saved['3']?.startsWith('已打款') && saved['4'] === priorPaid,
    'restart preserves unresolved D2 and paid D4 byte-for-byte and completes pending D3')
  assert.deepEqual(await calls(stopRoot), ['submit', 'submit', 'confirm'])
  const io = (await readFile(path.join(stopRoot, 'fixture', 'io-events.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
  const writes = io.filter(entry => entry.kind === 'write')
  check(writes.length > 0 && writes.every(entry => entry.data.column === 4), 'all persisted result writes target column D')
  await shot('06-restart-completed')
  const callsBefore = await calls(stopRoot)
  await activePage.getByRole('button', { name: '检查并准备', exact: true }).click()
  await activePage.getByText('没有可自动处理的行。', { exact: false }).waitFor({ timeout: 20000 })
  check(await activePage.getByRole('button', { name: '确认开始打款', exact: true }).isDisabled(), 'D-paid and unresolved rows cannot be started again')
  assert.deepEqual(await calls(stopRoot), callsBefore)
  await shot('07-D-resume-no-replay')
  await close('restart')
  await archive(stopRoot, 'restart')

  const all = [...await trace(resumeRoot), ...await trace(stopRoot)]
  for (const action of ['pausePayment', 'resumePayment', 'stop']) {
    check(all.some(entry => entry.channel === 'ui-request' && entry.request.action === action), `real button dispatches ${action} through preload IPC`)
  }
  const prepares = all.filter(entry => entry.channel === 'ui-request' && entry.request.action === 'preparePayment')
  check(prepares.length === 4 && prepares.every(entry => entry.request.transport === 'cdp' &&
    entry.request.amount === scenarioAmounts[entry.runId] && entry.request.mode === 'standard'),
  'all UI prepare requests retain their configured manual amounts and standard mode')
  const dispatches = all.filter(entry => entry.channel === 'host' && ['startPayment', 'resumePayment'].includes(entry.method))
  check(dispatches.length === 5 && dispatches.every(entry => entry.foreground === false),
    'real Controller forwards CDP start/resume without foreground grants')
  info.cdpEvidence = []
  for (const [name, root] of [['resume', resumeRoot], ['restart', stopRoot]]) {
    const configuredAmount = Number(scenarioAmounts[name === 'resume' ? '01-resume' : '05-restart'])
    const events = await cdpEvents(root)
    const methods = events.filter(entry => entry.kind === 'method').map(entry => entry.data)
    assert.deepEqual(methods.filter(entry => entry.method === 'prepareSearch').map(entry => entry.order), searchedOrders)
    check(true, `${name}: CDP searches eligible and nonexact records once and skips prior paid D4`)
    const records = methods.filter(entry => entry.method === 'inspectPaymentRecord')
    check(records.length === 5 && records.filter(entry => entry.reply.eligible).length === 2 &&
      records.filter(entry => entry.reply.eligible).every(entry => entry.reply.recordText === '暂无记录，每个订单最多打款5次'),
    `${name}: only the exact empty-record phrase is eligible at the Chrome boundary`)
    const money = methods.filter(entry => ['fillCompensation', 'verifyPrepared', 'submit', 'confirmation', 'confirm'].includes(entry.method))
    check(money.length > 0 && money.every(entry => entry.args[1] === configuredAmount && searchedOrders.slice(0, 2).includes(entry.order)),
      `${name}: eligible CDP calls retain configured amount ${configuredAmount} through pause/resume`)
    check(methods.filter(entry => ['fillCompensation', 'verifyPrepared'].includes(entry.method))
      .every(entry => entry.reply.amount === configuredAmount && entry.reply.paymentType === '补差价'),
    `${name}: CDP fill/verify replies confirm configured amount ${configuredAmount} and 补差价`)
    const inputs = events.filter(entry => entry.kind === 'input').map(entry => entry.data.value)
    check(inputs.filter(value => !searchedOrders.includes(value)).length === 2 &&
      inputs.filter(value => !searchedOrders.includes(value)).every(value => Number(value) === configuredAmount),
    `${name}: native CDP amount input matches the configured amount for both orders`)
    const closes = events.filter(entry => entry.kind === 'close')
    check(closes.length === (name === 'resume' ? 1 : 2) && closes.every(entry => entry.data.cancelledSession &&
      entry.data.independentCleanup && entry.data.screenConfirms === 0 && entry.data.screenSecondConfirms === 0),
    `${name}: each CDP session is cancelled and closed with zero screen confirmations`)
    check(closes.every(entry => events.some(previous => previous.pid === entry.pid && previous.kind === 'method' &&
      previous.data.method === 'cancel' && events.indexOf(previous) < events.indexOf(entry))), `${name}: current CDP order is cancelled before close`)
    const persisted = await disk(root, 'persisted.json')
    check(['5', '6', '7'].every(row => persisted[row]?.startsWith('跳过')), `${name}: incomplete, suffixed and prior-payment records persist skip in D`)
    info.cdpEvidence.push({ scenario: name, configuredAmount, inputs, searchedOrders, submitOrders: methods.filter(entry => entry.method === 'submit').map(entry => entry.order),
      confirmOrders: methods.filter(entry => entry.method === 'confirm').map(entry => entry.order), closes: closes.map(entry => entry.data), persisted })
  }
  await json('cdp-evidence.json', info.cdpEvidence)
  check(all.filter(entry => entry.channel === 'integrity').every(entry => entry.negative === 'corruption rejected'), 'real module verifier rejects corrupted fixture in every process')
  check(!all.some(entry => entry.channel === 'synthetic-api' && entry.route.includes('payment-grant')), 'no legacy grant API request')
  check(!entries.some(entry => entry.channel === 'renderer-error'), 'no renderer exceptions')
  info.result = 'passed'
  log('PAYMENT_CONTROLS_E2E_PASS', { output, assertions: assertions.length, screenshots: screenshots.length })
} catch (error) {
  info.result = 'failed'
  info.failure = String(error.stack || error)
  if (activePage) await shot('failure').catch(() => {})
  if (info.scenarios) {
    for (const [name, root] of Object.entries(info.scenarios)) await archive(root, `failure-${name}`).catch(() => {})
  }
  await writeFile(path.join(output, 'failure.txt'), info.failure)
  log('PAYMENT_CONTROLS_E2E_FAIL', { output, error: error.message })
  process.exitCode = 1
} finally {
  if (activeApp) {
    // Release only this run's synthetic response so EOF can drain the real worker.
    await writeFile(path.join(activeRoot, 'fixture', `${activeGate}.release`), 'cleanup synthetic Chrome response')
      .catch(error => { if (error.code !== 'ENOENT') log('gate cleanup failed', { error: error.message }) })
    await close('cleanup').catch(async error => {
      info.cleanupFailure = error.message
      info.result = 'failed'
      process.exitCode = 1
      log('cleanup failed', { error: error.message })
      if (activeApp) await activeApp.close().catch(() => {})
    })
    for (const [name, root] of Object.entries(info.scenarios ?? {})) await archive(root, `failure-${name}`).catch(() => {})
  }
  info.finishedAt = new Date().toISOString()
  await json('run-info.json', info)
  await json('assertions.json', assertions)
  await writeFile(path.join(output, 'run.log'), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
  const links = screenshots.map(name => `<p><a href="${name}">${name}</a><br><img src="${name}" style="max-width:100%"></p>`).join('\n')
  await writeFile(path.join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Payment controls CDP offline acceptance</title><h1>${info.result}</h1><p>Real Electron test-main, production UI/preload/Controller, real TD host/PaymentWorkflow.Cdp, synthetic auth/Excel/Chrome I/O. Production main.ts is outside this test coverage.</p><p>Production feige-payment.js runs separately in jsdom with poisoned chat/body getters.</p><p><a href="run-info.json">Run information</a> | <a href="assertions.json">Assertions</a> | <a href="run.log">Log</a> | <a href="cdp-evidence.json">CDP evidence</a> | <a href="dom-evidence.json">DOM evidence</a> | <a href="dom-tests.log">DOM tests</a> | <a href="resume-requests.jsonl">Resume trace</a> | <a href="restart-requests.jsonl">Restart trace</a></p>${links}`)
  console.log(`Evidence: ${output}`)
}
