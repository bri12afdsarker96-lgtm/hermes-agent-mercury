import assert from 'node:assert/strict'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(process.argv[2] ?? path.join(desktop, '../../results/shop-browser-native'))
await mkdir(root, { recursive: true })
const entry = path.join(root, 'fixture.cjs')
await build({
  entryPoints: [path.join(desktop, 'electron/shop-browser-native-fixture.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'warning'
})
const env = Object.fromEntries(
  ['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']
    .filter(key => process.env[key])
    .map(key => [key, process.env[key]])
)
env.PATH = path.join(process.env.SystemRoot, 'System32')
env.HERMES_SHOP_NATIVE_ROOT = root
const records = []
const bounds = { x: 20, y: 150, width: 1000, height: 540 }
let active
let native
const call = request => native.evaluate((api, value) => api.call({ sessionId: 'storage-test', ...value }), request)
const record = (step, value) => {
  records.push({ step, value, at: new Date().toISOString() })
  console.log(`PASS ${step}: ${JSON.stringify(value)}`)
}
const capture = async filename => {
  const page = await active.firstWindow()
  const png = await page.screenshot({ path: path.join(root, filename) })
  assert.ok(png.length > 1000, 'Electron screenshot must contain rendered pixels')
  record('screenshot', { filename, bytes: png.length })
}
const launch = async () => {
  active = await electron.launch({
    executablePath: path.join(desktop, 'node_modules/electron/dist/electron.exe'),
    args: [entry],
    cwd: desktop,
    env,
    timeout: 30000
  })
  const child = active.process()
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', bytes => {
      void appendFile(path.join(root, `electron-${child.pid}.txt`), bytes)
    })
  }
  await active.firstWindow()
  await active.evaluate(async () => {
    while (!globalThis.shopBrowserNative) await new Promise(resolve => setTimeout(resolve, 20))
  })
  native = await active.evaluateHandle(() => globalThis.shopBrowserNative)
  record('native-window', await native.evaluate(api => api.state()))
}
try {
  await launch()
  const first = (await call({ action: 'create' })).profile
  const second = (await call({ action: 'create' })).profile
  assert.ok(first && second && first.id !== second.id)
  assert.equal((await call({ action: 'open', profileId: first.id, target: 'merchant', bounds })).ok, true)
  await native.evaluate(api => api.putSyntheticCookie())
  const originalPath = (await native.evaluate(api => api.state())).storage
  assert.deepEqual(await native.evaluate(api => api.cookieNames()), ['hermes_storage_test'])
  await capture('01-native-profile.png')
  record('persistent-cookie-written', { profileId: first.id })
  await call({ action: 'close' })
  await active.close()
  active = undefined

  await launch()
  assert.equal((await call({ action: 'list' })).profiles.length, 2)
  await call({ action: 'open', profileId: first.id, target: 'merchant', bounds })
  assert.equal((await native.evaluate(api => api.state())).storage, originalPath)
  assert.deepEqual(await native.evaluate(api => api.cookieNames()), ['hermes_storage_test'])
  record('process-restart-restores-profile-and-cookie', true)
  await call({ action: 'open', profileId: second.id, target: 'feige', bounds })
  assert.deepEqual(await native.evaluate(api => api.cookieNames()), [])
  record('second-profile-cookie-isolation', true)
  assert.equal((await call({ action: 'relogin', profileId: first.id })).ok, true)
  await call({ action: 'open', profileId: first.id, target: 'merchant', bounds })
  assert.notEqual((await native.evaluate(api => api.state())).storage, originalPath)
  assert.deepEqual(await native.evaluate(api => api.cookieNames()), [])
  record('relogin-clears-cookie-and-rotates-storage', true)
  assert.equal((await call({ action: 'delete', profileId: second.id })).ok, true)
  await native.evaluate(api => api.revoke())
  assert.equal((await native.evaluate(api => api.state())).views, 0)
  assert.equal((await call({ action: 'open', profileId: first.id, target: 'merchant', bounds })).ok, false)
  record('revocation-detaches-native-view-and-rejects-open', true)
  await capture('02-native-revoked.png')
  await active.close()
  active = undefined

  await launch()
  assert.deepEqual(
    (await call({ action: 'list' })).profiles.map(profile => profile.id),
    [first.id]
  )
  record('deleted-profile-stays-deleted-after-restart', true)
} finally {
  if (active) await active.close()
  await writeFile(path.join(root, 'native-results.json'), JSON.stringify(records, null, 2))
}
console.log('NATIVE_PROFILE_STORAGE_PASS')
