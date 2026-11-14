import { app, BrowserWindow, ipcMain, session } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DoudianController, DoudianHost } from '#fixture-payment-host'
import type { DoudianRequest } from '../electron/doudian-types'

const source = process.env.HERMES_SYNTHETIC_PAYMENT_DIR
if (!source || !path.isAbsolute(source)) throw new Error('Absolute synthetic payment fixture directory required')
const root = mkdtempSync(path.join(os.tmpdir(), 'hermes-payment-pipe-'))
const bin = path.join(root, 'bin'); mkdirSync(bin)
app.setPath('userData', path.join(root, 'electron-data'))
const hashes: Record<string, string> = {
  'PaymentHostEngine.exe': '69fa5d56eab77fe90f21f0a88f5a4d17166a9bd535150e194ca51f27d9e2a53a',
  'Newtonsoft.Json.dll': 'e1e27af7b07eeedf5ce71a9255f0422816a6fc5849a483c6714e1b472044fa9d'
}
for (const [name, hash] of Object.entries(hashes)) {
  const from = path.join(source, name), to = path.join(bin, name)
  if (createHash('sha256').update(readFileSync(from)).digest('hex') !== hash) throw new Error(`Untrusted synthetic payment fixture: ${name}`)
  copyFileSync(from, to)
  if (createHash('sha256').update(readFileSync(to)).digest('hex') !== hash) throw new Error(`Synthetic fixture copy mismatch: ${name}`)
}
process.env.HERMES_PAYMENT_PIPE_ROOT = root
process.env.HERMES_PAYMENT_PIPE_MODE = 'unknown'
process.env.HERMES_SYNTHETIC_PAYMENT_ROOT = root
const audit = (entry: object) => appendFileSync(path.join(root, 'request-audit.jsonl'), JSON.stringify(entry) + '\n')
const allowedHostMethods = new Set(['initialize', 'capabilities', 'preparePayment', 'startPayment', 'status'])
const controller = new DoudianController({
  platform: process.platform, root, isCurrent: () => true,
  authorize: async () => 'a'.repeat(64),
  chooseWorkbook: async () => path.join(root, 'fixture', 'synthetic.xlsx'),
  verify: async () => path.join(bin, 'PaymentHostEngine.exe'),
  createHost: (executable: string) => {
    const launch = ((target, args, options) => {
      const child = spawn(target, args as string[], options)
      if (child.pid) process.env.HERMES_SYNTHETIC_HOST_PID = String(child.pid)
      return child
    }) as typeof spawn
    const host = new DoudianHost(executable, launch)
    return {
      request(method: string, params: Record<string, string> = {}) {
        audit({ channel: 'host', method })
        if (!allowedHostMethods.has(method)) throw new Error('SYNTHETIC_HOST_METHOD_BLOCKED')
        return host.request(method, params)
      },
      close() { host.close() }
    }
  }
})
const allowed = new Set(['capabilities', 'chooseWorkbook', 'preparePayment', 'startPayment', 'status'])
let window: BrowserWindow | undefined, prepared = false, started = false
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    const relative = url.protocol === 'file:' ? path.relative(path.join(__dirname, 'renderer'), fileURLToPath(url)) : ''
    const localAsset = url.protocol === 'file:' && relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    callback({ cancel: !localAsset && !['data:', 'blob:'].includes(url.protocol) })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window = new BrowserWindow({ width: 1280, height: 900, title: '本机模拟付款页面验收',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  ipcMain.handle('synthetic-payment', async (event, payload: Omit<DoudianRequest, 'sessionId'>) => {
    const action = typeof payload?.action === 'string' ? payload.action : 'invalid'
    audit({ channel: 'ui', action })
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !allowed.has(action)) return { ok: false, error: 'SYNTHETIC_ACTION_BLOCKED' }
    if (action === 'preparePayment') {
      if (prepared || payload.amount !== '3.25' || payload.startRow !== '2' || payload.maxRows !== '0' || payload.mode !== 'standard') return { ok: false, error: 'SYNTHETIC_ACTION_BLOCKED' }
      prepared = true
    }
    if (action === 'startPayment') {
      if (!prepared || started) return { ok: false, error: 'SYNTHETIC_ACTION_BLOCKED' }
      started = true
    }
    const reply = await controller.operate({ ...payload, sessionId: 'synthetic-payment-session' } as DoudianRequest)
    if (action === 'capabilities' && reply.ok && reply.capabilities) return { ...reply, capabilities: { ...reply.capabilities, paymentUi: 0, shopManagement: 0, shopOperations: 0 } }
    return reply
  })
  await window.loadURL(pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href)
}).catch(error => { console.error('Synthetic payment UI startup failed:', error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => controller.close())
