import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { configureRequestOptionsFromUrl, type DownloadOptions } from 'builder-util-runtime'
import { NodeHttpExecutor } from 'builder-util/out/nodeHttpExecutor'
import { NsisUpdater } from 'electron-updater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEnterprisePackageUpdater, type EnterprisePackageUpdaterOptions, supportsEnterpriseNsis, verifyEnterpriseInstaller } from './enterprise-package-updater'
import { ENTERPRISE_PACKAGE_APP_ID, ENTERPRISE_PACKAGE_FEED, EnterpriseObservedNsisUpdater,
  installEnterpriseUpdateSessionGuard, isAllowedEnterpriseUpdateUrl, type PackageUpdateDriver } from './enterprise-package-updater-native'

let root: string
let options: EnterprisePackageUpdaterOptions
let driver: PackageUpdateDriver
let location: { file: string, cacheRoot: string, baseCacheRoot: string }
let target: { version: string, sha512: string }
const content = Buffer.from('MZ-public-test-installer-bytes')
const digest = (value: Buffer) => createHash('sha512').update(value).digest('base64')

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'hermes-package-update-'))
  const resources = path.join(root, 'resources')
  await fs.mkdir(resources)
  await fs.writeFile(path.join(resources, 'enterprise-nsis-install.json'), JSON.stringify({ schemaVersion: 1, installer: 'nsis', appId: ENTERPRISE_PACKAGE_APP_ID }))
  location = { baseCacheRoot: path.join(root, 'cache'), cacheRoot: path.join(root, 'cache', 'enterprise-updater'), file: path.join(root, 'cache', 'enterprise-updater', 'pending', 'next.exe') }
  await fs.mkdir(path.dirname(location.file), { recursive: true })
  await fs.writeFile(location.file, content)
  target = { version: '0.18.1', sha512: digest(content) }
  driver = { check: vi.fn(async () => target), download: vi.fn(async () => location),
    handoff: vi.fn(async (_file, ready) => ready()), onProgress: () => () => {}, cancel: vi.fn(), dispose: vi.fn() }
  options = { isPackaged: true, currentVersion: '0.18.0', resourcesPath: resources, userDataPath: path.join(root, 'data'),
    platform: 'win32', arch: 'x64', driverFactory: () => driver,
    prepare: vi.fn(async () => ({ ready: true, isStillReady: () => true, release: vi.fn() })), onHandoff: vi.fn() }
})
afterEach(async () => { vi.useRealTimers(); await fs.rm(root, { recursive: true, force: true }) })

it('only a packaged x64 NSIS marker activates the independent package capability', async () => {
  expect(supportsEnterpriseNsis(options)).toBe(true)

  for (const variation of [{ isPackaged: false }, { platform: 'darwin' }, { arch: 'arm64' }]) {
    expect(supportsEnterpriseNsis({ ...options, ...variation })).toBe(false)
  }

  await fs.writeFile(path.join(options.resourcesPath, 'enterprise-nsis-install.json'), '{"schemaVersion":1,"installer":"msi"}')
  expect(supportsEnterpriseNsis(options)).toBe(false)
  expect(await createEnterprisePackageUpdater(options).installNow()).toMatchObject({ supported: false })
  expect(driver.check).not.toHaveBeenCalled()
})

it('downloads and records a version/hash intent without preparing, installing or storing paths', async () => {
  const controller = createEnterprisePackageUpdater(options)
  expect(await controller.scheduleNextLaunch()).toMatchObject({ phase: 'scheduled', nextLaunchScheduled: true })
  const intent = JSON.parse(await fs.readFile(path.join(options.userDataPath, 'enterprise-package-update-intent.json'), 'utf8'))
  expect(intent).toMatchObject({ version: target.version, sha512: target.sha512, mode: 'next-launch', attempt: 'scheduled' })
  expect(JSON.stringify(intent)).not.toContain(root)
  expect(Object.keys(intent).sort()).toEqual(['arch', 'attempt', 'createdAt', 'mode', 'schemaVersion', 'sha512', 'version'])
  expect(options.prepare).not.toHaveBeenCalled()
  expect(driver.handoff).not.toHaveBeenCalled()
  controller.dispose()
  expect(driver.handoff).not.toHaveBeenCalled() // ordinary quit never installs
})

it('startup rechecks the target, downloads via the vendor, hashes and attempts only once without renderer readiness', async () => {
  await createEnterprisePackageUpdater(options).scheduleNextLaunch()
  const nextProcess = createEnterprisePackageUpdater(options)
  expect(await nextProcess.recoverOnStartup()).toMatchObject({ phase: 'installing' })
  expect(options.prepare).not.toHaveBeenCalled()
  expect(options.onHandoff).toHaveBeenCalledTimes(1)
  await nextProcess.recoverOnStartup()
  expect(options.onHandoff).toHaveBeenCalledTimes(1)
  const unsuccessfulRestart = createEnterprisePackageUpdater(options)
  expect(await unsuccessfulRestart.recoverOnStartup()).toMatchObject({ phase: 'blocked' })
  expect(options.onHandoff).toHaveBeenCalledTimes(1)
  const installedRestart = createEnterprisePackageUpdater({ ...options, currentVersion: target.version })
  expect(await installedRestart.recoverOnStartup()).toMatchObject({ phase: 'idle', nextLaunchScheduled: false, message: '客户端已更新' })
})

it.each(['hash', 'version', 'withdrawn'])('startup never silently substitutes an altered %s target', async change => {
  await createEnterprisePackageUpdater(options).scheduleNextLaunch()
  driver.check = vi.fn(async () => change === 'withdrawn' ? null : ({ ...target,
    ...(change === 'hash' ? { sha512: digest(Buffer.from('replacement')) } : { version: '0.18.2' }) }))
  const result = await createEnterprisePackageUpdater(options).recoverOnStartup()
  expect(['error', 'blocked']).toContain(result.phase)
  expect(driver.handoff).not.toHaveBeenCalled()
  expect(options.onHandoff).not.toHaveBeenCalled()
})

it('corrupt intent is bounded and cannot nominate an arbitrary executable', async () => {
  await fs.mkdir(options.userDataPath)
  await fs.writeFile(path.join(options.userDataPath, 'enterprise-package-update-intent.json'), JSON.stringify({ ...target, file: location.file }))
  expect(await createEnterprisePackageUpdater(options).recoverOnStartup()).toMatchObject({ phase: 'error' })
  expect(driver.check).not.toHaveBeenCalled()
})

it('late startup metadata cannot launch after the bounded recovery returns', async () => {
  await createEnterprisePackageUpdater(options).scheduleNextLaunch()
  let finish: (value: typeof target) => void
  driver.check = vi.fn(() => new Promise<typeof target>(resolve => { finish = resolve }))
  const controller = createEnterprisePackageUpdater({ ...options, startupTimeoutMs: 25 })
  expect(await controller.recoverOnStartup()).toMatchObject({ phase: 'error' })
  finish!(target)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(driver.handoff).not.toHaveBeenCalled()
  expect(driver.download).toHaveBeenCalledTimes(1) // initial scheduling only
})

it('last-moment readiness invalidation keeps the app and releases the lease', async () => {
  const release = vi.fn()
  let ready = true
  options.prepare = vi.fn(async () => ({ ready: true, isStillReady: () => ready, release }))
  driver.handoff = vi.fn(async (_file, check) => { ready = false;

 return check() })
  expect(await createEnterprisePackageUpdater(options).installNow()).toMatchObject({ phase: 'error' })
  expect(release).toHaveBeenCalledTimes(1)
  expect(options.onHandoff).not.toHaveBeenCalled()
})

it('timeout releases an acquired readiness lease and fences a late handoff completion', async () => {
  const release = vi.fn()
  options.prepare = vi.fn(async () => ({ ready: true, isStillReady: () => true, release }))
  let finish: (ready: boolean) => void
  driver.handoff = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  // Leave enough time for the install observation reservation, then expire while it waits.
  const controller = createEnterprisePackageUpdater({ ...options, operationTimeoutMs: 2050 })
  const result = await controller.installNow()
  expect(result.phase).toBe('error')
  expect(release).toHaveBeenCalledTimes(1)
  finish!(true)
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(options.onHandoff).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledTimes(1)
})

it('a successful handoff keeps the readiness freeze through asynchronous app teardown', async () => {
  const release = vi.fn()
  options.prepare = vi.fn(async () => ({ ready: true, isStillReady: () => true, release }))
  const controller = createEnterprisePackageUpdater(options)
  expect(await controller.installNow()).toMatchObject({ phase: 'installing' })
  controller.dispose()
  expect(options.onHandoff).toHaveBeenCalledTimes(1)
  expect(release).not.toHaveBeenCalled()
})

it('readiness refusal and failed app handoff callback restore editors', async () => {
  const release = vi.fn()
  options.prepare = vi.fn(async () => ({ ready: false, reasons: ['草稿冲突'], isStillReady: () => false, release }))
  expect(await createEnterprisePackageUpdater(options).installNow()).toMatchObject({ phase: 'blocked', reasons: ['草稿冲突'] })
  expect(release).toHaveBeenCalledTimes(1)
  expect(driver.handoff).not.toHaveBeenCalled()
  options.prepare = vi.fn(async () => ({ ready: true, isStillReady: () => true, release }))
  options.onHandoff = vi.fn(() => { throw new Error('quit rejected') })
  expect(await createEnterprisePackageUpdater(options).installNow()).toMatchObject({ phase: 'error' })
  expect(release).toHaveBeenCalledTimes(2)
})

it('revalidates the same-process cached EXE and rejects changed bytes and junction escape', async () => {
  expect(await verifyEnterpriseInstaller(location, target.sha512)).toBe(location.file)
  await fs.writeFile(location.file, Buffer.from('MZ-replaced'))
  await expect(verifyEnterpriseInstaller(location, target.sha512)).rejects.toThrow('installer-changed')
  const outside = path.join(root, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'next.exe'), content)
  await fs.rm(path.dirname(location.file), { recursive: true })
  await fs.symlink(outside, path.dirname(location.file), 'junction')
  await expect(verifyEnterpriseInstaller(location, target.sha512)).rejects.toThrow('unsafe-cache-file')
})

it('checks every request and redirect and removes business authentication and cookies', () => {
  const hooks: Record<string, any> = {}
  const webRequest = Object.fromEntries(['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived'].map(name => [name, (_filter: unknown, callback: unknown) => { hooks[name] = callback }]))
  const dispose = installEnterpriseUpdateSessionGuard({ webRequest } as any)
  const callback = vi.fn()
  const allowed = ENTERPRISE_PACKAGE_FEED + 'latest.yml?noCache=123'
  hooks.onBeforeRequest({ method: 'GET', url: allowed }, callback)
  expect(callback).toHaveBeenLastCalledWith({ cancel: false })
  hooks.onBeforeSendHeaders({ url: allowed, requestHeaders: { Authorization: 'secret', Cookie: 'session', 'Proxy-Authorization': 'secret', Referer: 'business', Range: 'bytes=0-99' } }, callback)
  expect(callback).toHaveBeenLastCalledWith({ cancel: false, requestHeaders: { Range: 'bytes=0-99' } })
  hooks.onHeadersReceived({ url: allowed, statusCode: 302, responseHeaders: { Location: ['https://attacker.invalid/x.exe'], 'Set-Cookie': ['private'] } }, callback)
  expect(callback.mock.lastCall![0].cancel).toBe(true)
  expect(callback.mock.lastCall![0].responseHeaders['Set-Cookie']).toBeUndefined()
  dispose()
  hooks.onBeforeRequest({ method: 'GET', url: allowed }, callback)
  expect(callback).toHaveBeenLastCalledWith({ cancel: true })
})

it.each([
  'http://ppbb096.site/desktop-updates/windows/x64/a.exe',
  'https://ppbb096.site.attacker.invalid/desktop-updates/windows/x64/a.exe',
  'https://user@ppbb096.site/desktop-updates/windows/x64/a.exe',
  ENTERPRISE_PACKAGE_FEED + '..%2fsecret.exe', ENTERPRISE_PACKAGE_FEED + 'folder/a.exe',
  ENTERPRISE_PACKAGE_FEED + 'a.exe?token=secret', 'file:///tmp/a.exe'
])('denies an untrusted release address %s', url => expect(isAllowedEnterpriseUpdateUrl(url)).toBe(false))

function testApp(): AppAdapter {
  return { version: options.currentVersion, name: 'enterprise-test', isPackaged: true,
    userDataPath: options.userDataPath, baseCachePath: location.baseCacheRoot,
    appUpdateConfigPath: path.join(root, 'app-update.yml'), whenReady: async () => {}, quit() {}, relaunch() {}, onQuit() {} }
}

describe('vendor NSIS install + narrow spawn observation', () => {
  function subject(spawnProcess: any) {
    // Real vendor initialization with its documented test AppAdapter. Production
    // uses the normal Electron adapter. Only the OS child process is substituted.
    const updater = new NsisUpdater(undefined, testApp()) as any
    Object.setPrototypeOf(updater, EnterpriseObservedNsisUpdater.prototype)
    Object.assign(updater, { observation: null, allowedInstaller: null, stillReady: null, activeChild: null, spawnGeneration: 0,
      spawnDependencies: { spawnProcess, settleMs: 20 }, downloadedUpdateHelper: { file: location.file, downloadedFileInfo: { isAdminRightsRequired: false } } })
    updater.logger = null
    updater.autoInstallOnAppQuit = false

    return updater as EnterpriseObservedNsisUpdater
  }

  function child() {
    return Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, unref: vi.fn(), kill: vi.fn() })
  }

  it.each(['error', 'exit', 'signal'])('keeps the app on observable %s and permits explicit retry', async failure => {
    const launch = vi.fn(() => {
      const process = child()
      queueMicrotask(() => failure === 'error'
        ? process.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' }))
        : process.emit('exit', failure === 'exit' ? 0 : null, failure === 'signal' ? 'SIGTERM' : null))

      return process
    })

    const updater = subject(launch)
    expect(await updater.installObserved(location.file, () => true)).toBe(false)
    expect(await updater.installObserved(location.file, () => true)).toBe(false)
    expect(launch).toHaveBeenCalledTimes(2) // no elevate.exe or shell fallback
  })
  it('uses vendor argv and requires a surviving child plus fresh readiness', async () => {
    const process = child()
    const launch = vi.fn((_command: string, _args: string[]) => process)
    const updater = subject(launch)
    expect(await updater.installObserved(location.file, () => true)).toBe(true)
    expect(launch.mock.calls[0][0]).toBe(location.file)
    expect(launch.mock.calls[0][1]).toEqual(['--updated', '/S', '--force-run'])
    expect(process.unref).toHaveBeenCalledTimes(1)
  })
  it('observes a real OS child early exit rather than treating its PID as success', async () => {
    const updater = subject(() => spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true, stdio: 'ignore' }))

    ;(updater as any).spawnDependencies.settleMs = 500
    expect(await updater.installObserved(location.file, () => true)).toBe(false)
  })
})

it('uses the real vendor HTTP download/cache/SHA512 path and detects a corrupted same-process cache', async () => {
  // The vendor's Node executor lacks the Electron-specific download wrapper.
  // Adapt only that boundary to its own streaming doDownload implementation.
  class LoopbackExecutor extends NodeHttpExecutor {
    download(url: URL, destination: string, downloadOptions: DownloadOptions) {
      return downloadOptions.cancellationToken.createPromise<void>((resolve, reject, onCancel) => {
        this.doDownload(configureRequestOptionsFromUrl(url.href, { headers: downloadOptions.headers }), {
          destination, options: downloadOptions, onCancel, responseHandler: null,
          callback: error => error ? reject(error) : resolve()
        }, 0)
      })
    }
  }
  let exeRequests = 0

  const server = createServer((request, response) => {
    if (request.url?.startsWith('/latest.yml')) {
      response.end(JSON.stringify({ version: target.version, files: [{ url: 'next.exe', sha512: target.sha512, size: content.length }] }))
    } else if (request.url === '/next.exe') {
      exeRequests++
      response.setHeader('Content-Length', content.length)
      response.end(content)
    } else { response.statusCode = 404; response.end() }
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const adapter = testApp()
  await fs.writeFile(adapter.appUpdateConfigPath, 'updaterCacheDirName: enterprise-updater\n')

  const makeUpdater = () => {
    const updater = new NsisUpdater(undefined, adapter)
    Object.defineProperty(updater, 'httpExecutor', { value: new LoopbackExecutor() })
    updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${address.port}/` })
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.disableDifferentialDownload = true
    updater.disableWebInstaller = true
    updater.logger = null

    return updater
  }

  try {
    const updater = makeUpdater()
    expect((await updater.checkForUpdates())?.isUpdateAvailable).toBe(true)
    const [downloaded] = await updater.downloadUpdate()
    expect(await verifyEnterpriseInstaller({ ...location, file: downloaded }, target.sha512)).toBe(downloaded)
    expect(exeRequests).toBe(1)
    await fs.writeFile(downloaded, Buffer.from('MZ-modified-same-process-cache'))
    // 6.8.9 reuses an existing same-process file; our install boundary must reject it.
    const [reused] = await updater.downloadUpdate()
    expect(exeRequests).toBe(1)
    await expect(verifyEnterpriseInstaller({ ...location, file: reused }, target.sha512)).rejects.toThrow('installer-changed')
    const restarted = makeUpdater()
    await restarted.checkForUpdates()
    const [repaired] = await restarted.downloadUpdate()
    expect(exeRequests).toBe(2) // cross-process vendor SHA512 check triggers fresh download
    await expect(verifyEnterpriseInstaller({ ...location, file: repaired }, target.sha512)).resolves.toBe(repaired)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
