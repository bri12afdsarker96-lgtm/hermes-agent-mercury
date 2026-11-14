import { app, BrowserWindow, ipcMain, session } from 'electron'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DoudianController } from '../electron/doudian-host'
import type { DoudianRequest } from '../electron/doudian-types'

const fixtureHashes: Record<string, string> = {
  'HermesHostIsolationTests.exe': 'b57a8f458b4a1751d7fc27f8aa967a2a16adbb81e1d74605f09531ead995fa16',
  'Newtonsoft.Json.dll': 'e1e27af7b07eeedf5ce71a9255f0422816a6fc5849a483c6714e1b472044fa9d'
}
const fixtureSource = process.env.HERMES_SYNTHETIC_TD_DIR
if (!fixtureSource || !path.isAbsolute(fixtureSource)) throw new Error('Absolute synthetic fixture directory required')
const temp = mkdtempSync(path.join(os.tmpdir(), 'hermes-synthetic-ui-'))
app.setPath('userData', path.join(temp, 'electron-data'))
for (const [name, hash] of Object.entries(fixtureHashes)) {
  const source = path.join(fixtureSource, name)
  if (createHash('sha256').update(readFileSync(source)).digest('hex') !== hash) throw new Error(`Unexpected synthetic fixture: ${name}`)
  const target = path.join(temp, name)
  copyFileSync(source, target)
  if (createHash('sha256').update(readFileSync(target)).digest('hex') !== hash) throw new Error(`Fixture copy mismatch: ${name}`)
}
const workbook = path.join(temp, 'synthetic-review.xlsx')
writeFileSync(workbook, 'synthetic test fixture, not a real workbook')
process.env.HERMES_TEST_TRACE = path.join(temp, 'synthetic-trace.jsonl')
const controller = new DoudianController({
  platform: process.platform, root: temp, isCurrent: () => true,
  authorize: async () => 'a'.repeat(64),
  chooseWorkbook: async () => workbook,
  verify: async () => path.join(temp, 'HermesHostIsolationTests.exe')
})
const allowed = new Set(['capabilities', 'shops', 'chooseWorkbook', 'prepare', 'start', 'status', 'stop'])
let window: BrowserWindow | undefined

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    const relative = url.protocol === 'file:' ? path.relative(path.join(__dirname, 'renderer'), fileURLToPath(url)) : ''
    const localAsset = url.protocol === 'file:' && relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    callback({ cancel: !localAsset && !['data:', 'blob:'].includes(url.protocol) })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window = new BrowserWindow({ width: 1280, height: 900, title: '本机合成验收 · 付款不可用',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  ipcMain.handle('synthetic-review', async (event, payload: Omit<DoudianRequest, 'sessionId'>) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        !payload || !allowed.has(payload.action)) return { ok: false, error: 'SYNTHETIC_ACTION_BLOCKED' }
    if (payload.action === 'prepare' && payload.shopId !== 'b'.repeat(32)) return { ok: false, error: 'SYNTHETIC_ACTION_BLOCKED' }
    const reply = await controller.operate({ ...payload, sessionId: 'synthetic-session' } as DoudianRequest)
    if (payload.action === 'capabilities' && reply.ok && reply.capabilities) {
      return { ...reply, capabilities: { ...reply.capabilities, shopManagement: 0, shopOperations: 0, paymentUi: 0 } }
    }
    if (payload.action === 'shops' && reply.ok) {
      return { ...reply, shops: (reply.shops ?? []).filter(shop => shop.id === 'b'.repeat(32)).map(shop => ({ ...shop, name: '合成店铺', platformId: 'TEST-ONLY' })) }
    }
    return reply
  })
  const url = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href
  await window.loadURL(url)
}).catch(error => { console.error('Synthetic UI startup failed:', error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => controller.close())
