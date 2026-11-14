import { app, BrowserWindow, ipcMain, session } from 'electron'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DoudianController, DoudianHost } from '../electron/doudian-host'
import type { DoudianRequest } from '../electron/doudian-types'
import pins from './fixtures.json'

const fixtures = process.env.HERMES_SYNTHETIC_FIXTURES
if (!fixtures || !path.isAbsolute(fixtures)) throw new Error('Synthetic fixture root required')
const root = mkdtempSync(path.join(os.tmpdir(), 'hermes-payment-pipe-'))
app.setPath('userData', path.join(root, 'electron-data'))
function copyPinned(kind: 'review' | 'payment') {
  const dir = path.join(root, kind); mkdirSync(dir)
  for (const {file: name, sha256: expected} of [pins[kind], pins.dll]) {
    const from = path.join(fixtures!, pins[kind].directory, name), to = path.join(dir, name)
    if (createHash('sha256').update(readFileSync(from)).digest('hex') !== expected) throw new Error(`Fixture hash mismatch: ${kind}/${name}`)
    copyFileSync(from, to)
    if (createHash('sha256').update(readFileSync(to)).digest('hex') !== expected) throw new Error(`Fixture copy mismatch: ${kind}/${name}`)
  }
  return path.join(dir, pins[kind].file)
}
const executables = { review: copyPinned('review'), payment: copyPinned('payment') }
const reviewWorkbook = path.join(root, 'review-synthetic.xlsx'); writeFileSync(reviewWorkbook, 'synthetic test only')
process.env.HERMES_TEST_TRACE = path.join(root, 'review-trace.jsonl')
process.env.HERMES_PAYMENT_PIPE_ROOT = root; process.env.HERMES_PAYMENT_PIPE_MODE = 'unknown'; process.env.HERMES_SYNTHETIC_ROOT = root
const log = (entry: object) => appendFileSync(path.join(root, 'audit.jsonl'), JSON.stringify(entry) + '\n')
const sessionId = 'synthetic-session'
let loggedIn = false, phase: 'review' | 'payment' = 'review', reviewComplete = false, prepared = false, started = false
let window: BrowserWindow | undefined
function makeController(kind: 'review' | 'payment') {
  const allowed = kind === 'review' ? new Set(['initialize','capabilities','shops','prepare','start','status']) : new Set(['initialize','capabilities','preparePayment','startPayment','status'])
  return new DoudianController({ platform: process.platform, root, isCurrent: () => loggedIn,
    authorize: async () => 'a'.repeat(64), chooseWorkbook: async () => kind === 'review' ? reviewWorkbook : path.join(root, 'fixture', 'synthetic.xlsx'),
    verify: async () => executables[kind], createHost: executable => {
      const launch = ((target, args, options) => { const child = spawn(target, args as string[], options); if(child.pid) process.env[`SYNTHETIC_${kind.toUpperCase()}_PID`] = String(child.pid); return child }) as typeof spawn
      const host = new DoudianHost(executable, launch)
      return { request(method: string, params: Record<string,string> = {}) { log({ kind, channel: 'host', method }); if (!allowed.has(method)) throw new Error('SYNTHETIC_METHOD_BLOCKED'); return host.request(method, params) }, close() { host.close() } }
    } })
}
const controllers = { review: makeController('review'), payment: makeController('payment') }
const identity = { principal_id: 'synthetic-operator', tenant_id: 'synthetic-tenant', tenant_name: '模拟企业', name: '模拟员工', role: 'operator', effective_permissions: ['*'],
  product_capabilities: { doudian_review: { enabled: true, status: 'LIVE' }, doudian_payment: { enabled: true, status: 'LIVE' } }, desktop_surfaces: { schema_version: 1, surfaces: {} } }
const valid = (event: Electron.IpcMainInvokeEvent) => !!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const u = new URL(details.url); const relative = u.protocol === 'file:' ? path.relative(path.join(__dirname,'renderer'), fileURLToPath(u)) : ''; callback({ cancel: !(u.protocol === 'file:' && relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) && !['data:','blob:'].includes(u.protocol) }) })
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback) => callback(false))
  window = new BrowserWindow({ width: 1360, height: 900, title: '合成企业助手测试', webPreferences: { preload: path.join(__dirname,'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault())
  ipcMain.handle('hermes:enterprise:auto-connect', () => ({ ok:false, code:'no_native_session' }))
  ipcMain.handle('hermes:enterprise:remembered-login', () => null)
  ipcMain.handle('hermes:enterprise:pre-release-access-status', () => ({ enabled:false, stage:'disabled', message:'' }))
  ipcMain.handle('hermes:enterprise:package-update-status', () => ({ state:'idle' }))
  ipcMain.handle('hermes:enterprise:login-password', (event, payload) => { if (!valid(event) || payload?.loginName !== 'synthetic' || payload?.password !== 'synthetic') return { ok:false, code:'invalid_credentials' }; loggedIn = true; log({channel:'login', outcome:'synthetic'}); return {ok:true,sessionId,baseUrl:'http://127.0.0.1:49152'} })
  ipcMain.handle('hermes:enterprise:disconnect', () => ({ok:true}))
  ipcMain.handle('hermes:enterprise:request', (event, req) => {
    if (!valid(event) || !loggedIn || req?.sessionId !== sessionId || req.method !== 'GET') return {kind:'error',status:403}
    const route = new URL(req.path,'http://fixture.invalid').pathname
    const data = route === '/api/whoami' ? identity : route === '/api/health' ? {ok:true,auth_mode:'synthetic'} : route === '/api/metrics' ? {alerts:[]} : {available:false,configured:false,entries:[],reminders:[],tasks:[],groups:[],staff:[]}
    return {kind:'ok',data}
  })
  ipcMain.handle('hermes:enterprise:doudian', async (event, payload: DoudianRequest) => {
    const action = payload?.action; log({channel:'ui', action})
    const allow = new Set(['capabilities','shops','chooseWorkbook','prepare','start','status','preparePayment','startPayment'])
    if (!valid(event) || !loggedIn || payload?.sessionId !== sessionId || !allow.has(action)) return {ok:false,error:'SYNTHETIC_ACTION_BLOCKED'}
    if (action === 'prepare' && payload.shopId !== 'b'.repeat(32)) return {ok:false,error:'SYNTHETIC_ACTION_BLOCKED'}
    if (action === 'preparePayment') { if (prepared || payload.amount !== '3.25' || payload.startRow !== '2' || payload.maxRows !== '0' || payload.mode !== 'standard') return {ok:false,error:'SYNTHETIC_ACTION_BLOCKED'}; prepared=true }
    if (action === 'startPayment') { if (!prepared || started) return {ok:false,error:'SYNTHETIC_ACTION_BLOCKED'}; started=true }
    if (action === 'capabilities' && reviewComplete && phase === 'review') { phase='payment'; log({channel:'test',phase}) }
    const reply = await controllers[phase].operate(payload)
    if (phase === 'review' && reply.task?.state === 'completed') reviewComplete = true
    if (action === 'shops' && reply.ok) return {...reply,shops:(reply.shops ?? []).filter(s=>s.id === 'b'.repeat(32)).map(s=>({...s,name:'合成店铺',platformId:'TEST-ONLY'}))}
    if (action === 'capabilities' && reply.ok && reply.capabilities) return {...reply,capabilities:{...reply.capabilities,shopManagement:0,shopOperations:0,paymentUi:0}}
    return reply
  })
  await window.loadURL(pathToFileURL(path.join(__dirname,'renderer','index.html')).href)
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { controllers.review.close(); controllers.payment.close() })
