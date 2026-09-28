/** Narrow adapter over electron-updater 6.8.9; NSIS argv and downloading stay vendor-owned. */
import { type ChildProcess, spawn, type StdioOptions } from 'node:child_process'

import { CancellationToken } from 'builder-util-runtime'
import type { Session } from 'electron'
import { NsisUpdater } from 'electron-updater'

import { observeUpdaterHandoff } from './updater-process'

export const ENTERPRISE_PACKAGE_FEED = 'https://ppbb096.site/desktop-updates/windows/x64/'
export const ENTERPRISE_PACKAGE_APP_ID = 'com.qiqiaoban.hermes-enterprise-assistant'

export interface PackageUpdateTarget {
  version: string
  sha512: string
}

export interface PackageDownloadLocation {
  file: string
  cacheRoot: string
  baseCacheRoot: string
}

export interface PackageUpdateDriver {
  check(): Promise<PackageUpdateTarget | null>
  download(): Promise<PackageDownloadLocation>
  handoff(file: string, stillReady: () => boolean): Promise<boolean>
  onProgress(listener: (percent: number) => void): () => void
  cancel(): void
  dispose(): void
}

/** Fixed origin and flat asset namespace, including every redirect and blockmap. */
export function isAllowedEnterpriseUpdateUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const feed = new URL(ENTERPRISE_PACKAGE_FEED)

    if (url.origin !== feed.origin || url.protocol !== 'https:' || url.username || url.password || url.hash) {return false}

    if (!url.pathname.startsWith(feed.pathname)) {return false}
    const file = decodeURIComponent(url.pathname.slice(feed.pathname.length))

    // Asset names must reject decoded control bytes and path separators.
    // eslint-disable-next-line no-control-regex
    if (!file || /[\\/\x00-\x1f]/.test(file) || file === '.' || file === '..') {return false}

    if (file !== 'latest.yml' && !/\.(exe|blockmap)$/i.test(file)) {return false}

    // GenericProvider's own cache buster is the only query needed by this feed.
    return [...url.searchParams].every(([key, val]) => key === 'noCache' && /^[\w-]{1,80}$/.test(val))
  } catch {
    return false
  }
}

export function installEnterpriseUpdateSessionGuard(session: Session): () => void {
  let active = true
  const filter = { urls: ['<all_urls>'] }
  session.webRequest.onBeforeRequest(filter, (details, callback) => {
    callback({ cancel: !active || !['GET', 'HEAD'].includes(details.method) || !isAllowedEnterpriseUpdateUrl(details.url) })
  })
  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...details.requestHeaders }

    for (const key of Object.keys(headers)) {
      if (['authorization', 'proxy-authorization', 'cookie', 'referer'].includes(key.toLowerCase())) {delete headers[key]}
    }

    callback({ cancel: !active || !isAllowedEnterpriseUpdateUrl(details.url), requestHeaders: headers })
  })
  session.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...details.responseHeaders }
    let cancel = !active || !isAllowedEnterpriseUpdateUrl(details.url)

    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'set-cookie') {delete headers[key]}

      if (key.toLowerCase() === 'location' && details.statusCode >= 300 && details.statusCode < 400) {
        try {
          cancel ||= headers[key].some(location => !isAllowedEnterpriseUpdateUrl(new URL(location, details.url).href))
        } catch {
          cancel = true
        }
      }
    }

    callback({ cancel, responseHeaders: headers })
  })

  return () => {
    // In-flight vendor checks can finish late. Leave this isolated session
    // blocked instead of briefly removing its trust boundary on disposal.
    active = false
  }
}

export interface NsisSpawnDependencies {
  spawnProcess?: typeof spawn
  settleMs?: number
}

/** No AppAdapter injection in production: that disables the vendor HTTP executor. */
export class EnterpriseObservedNsisUpdater extends NsisUpdater {
  private observation: Promise<boolean> | null = null
  private allowedInstaller: string | null = null
  private stillReady: (() => boolean) | null = null
  private activeChild: ChildProcess | null = null
  private spawnGeneration = 0

  constructor(private readonly spawnDependencies: NsisSpawnDependencies = {}) {
    super({ provider: 'generic', url: ENTERPRISE_PACKAGE_FEED, useMultipleRangeRequest: false })
    this.autoDownload = false
    this.autoInstallOnAppQuit = false
    this.autoRunAppAfterInstall = true
    this.allowDowngrade = false
    this.allowPrerelease = false
    this.disableWebInstaller = true
    this.logger = null // Vendor diagnostics may contain feed metadata/query strings.
  }

  async checkedTarget(): Promise<PackageUpdateTarget | null> {
    const result = await this.checkForUpdates()

    if (!result?.isUpdateAvailable) {return null}
    const resolved = this.updateInfoAndProvider?.provider.resolveFiles(result.updateInfo)

    if (!resolved?.length || resolved.some(item => item.packageInfo || !isAllowedEnterpriseUpdateUrl(item.url.href))) {
      throw new Error('untrusted-release')
    }

    const installers = resolved.filter(item => item.url.pathname.toLowerCase().endsWith('.exe'))

    if (installers.length !== 1) {throw new Error('ambiguous-installer')}
    const sha512 = installers[0].info.sha512

    if (typeof sha512 !== 'string' || Buffer.from(sha512, 'base64').length !== 64 || Buffer.from(sha512, 'base64').toString('base64') !== sha512) {
      throw new Error('invalid-release-hash')
    }

    if (typeof result.updateInfo.version !== 'string' || result.updateInfo.version.length > 80) {throw new Error('invalid-release-version')}

    return { version: result.updateInfo.version, sha512 }
  }

  downloadLocation(): PackageDownloadLocation {
    const helper = this.downloadedUpdateHelper

    if (!helper || !this.installerPath || helper.packageFile || helper.downloadedFileInfo?.isAdminRightsRequired) {
      throw new Error('unsupported-installer')
    }

    return { file: this.installerPath, cacheRoot: helper.cacheDir, baseCacheRoot: this.app.baseCachePath }
  }

  async installObserved(file: string, stillReady: () => boolean): Promise<boolean> {
    if (this.observation || this.allowedInstaller) {return false}
    this.allowedInstaller = file
    this.stillReady = stillReady
    this.quitAndInstallCalled = false

    try {
      if (this.installerPath !== file || !stillReady()) {return false}

      if (!this.install(true, true)) {return false}

      return this.observation ? await this.observation : false
    } finally {
      this.allowedInstaller = null
      this.stillReady = null
      this.observation = null
      this.activeChild = null
      this.quitAndInstallCalled = false
    }
  }

  abortObservation(): void {
    this.spawnGeneration++
    this.activeChild?.kill()
  }

  protected spawnLog(command: string, args: string[] = [], env?: NodeJS.ProcessEnv, stdio?: StdioOptions): Promise<boolean> {
    // Reject elevation and any second process. Sanitized rejection codes prevent
    // vendor EACCES/ENOENT from invoking unobservable elevate/shell fallbacks.
    const reject = () => Promise.reject(Object.assign(new Error('installer-handoff-failed'), { code: 'ENTERPRISE_HANDOFF_FAILED' }))

    if (this.observation || command !== this.allowedInstaller || !this.stillReady?.()) {return reject()}
    const generation = ++this.spawnGeneration

    try {
      const child = (this.spawnDependencies.spawnProcess ?? spawn)(command, args, {
        detached: true, windowsHide: true, stdio: stdio ?? 'ignore', env
      })

      if (typeof child.once !== 'function') {return reject()}
      this.activeChild = child
      // NSIS is the actual installer, not cmd-start: even early exit 0 is a failure.
      let exited = false

      const markExited = () => { exited = true }
      child.once('exit', markExited)
      const observed = observeUpdaterHandoff(child, this.spawnDependencies.settleMs ?? 1500)
      child.on('error', () => {}) // A late OS event must never crash the old app.
      this.observation = observed.then(result => {
        child.removeListener('exit', markExited)
        const ok = Boolean(child.pid) && result.ok && !exited && generation === this.spawnGeneration && Boolean(this.stillReady?.())

        if (!ok && child.exitCode === null) {child.kill()}

        if (ok) {child.unref()}

        return ok
      })

      // NsisUpdater adds its own asynchronous failure handler. Never let it
      // translate an OS error into another executable or shell.openPath.
      return this.observation.then(ok => ok ? true : reject())
    } catch {
      this.observation = Promise.resolve(false)

      return reject()
    }
  }
}

export function createNativePackageUpdateDriver(): PackageUpdateDriver {
  const updater = new EnterpriseObservedNsisUpdater()
  const removeGuard = installEnterpriseUpdateSessionGuard(updater.netSession)
  let token: CancellationToken | null = null

  return {
    check: () => updater.checkedTarget(),
    async download() {
      token = new CancellationToken()
      await updater.downloadUpdate(token)

      return updater.downloadLocation()
    },
    handoff: (file, ready) => updater.installObserved(file, ready),
    onProgress(listener) {
      const handler = (event: { percent: number }) => listener(event.percent)
      updater.on('download-progress', handler)

      return () => updater.removeListener('download-progress', handler)
    },
    cancel() { token?.cancel(); updater.abortObservation() },
    dispose() { token?.cancel(); updater.abortObservation(); removeGuard(); updater.removeAllListeners(); updater.on('error', () => {}) }
  }
}
