/** Application-owned orchestration; vendor owns version selection, downloads and NSIS. */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { promises as fs, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { gt, valid } from 'semver'

import {
  createNativePackageUpdateDriver, ENTERPRISE_PACKAGE_APP_ID,
  type PackageDownloadLocation, type PackageUpdateDriver, type PackageUpdateTarget
} from './enterprise-package-updater-native'
import type { EnterprisePackageReadinessLease, EnterprisePackageUpdateState } from './enterprise-package-updater-types'
export type { EnterprisePackageReadinessLease, EnterprisePackageUpdateState } from './enterprise-package-updater-types'

export interface EnterprisePackageUpdaterOptions {
  isPackaged: boolean
  currentVersion: string
  resourcesPath: string
  userDataPath: string
  platform?: string
  arch?: string
  prepare(transactionId: string): Promise<EnterprisePackageReadinessLease>
  onHandoff(transactionId: string): void
  /** Dependency seams for isolated tests; never supplied through IPC. */
  driverFactory?: () => PackageUpdateDriver
  startupTimeoutMs?: number
  operationTimeoutMs?: number
}

interface UpdateIntent extends PackageUpdateTarget {
  schemaVersion: 1
  mode: 'next-launch'
  arch: 'x64'
  createdAt: number
  attempt: 'scheduled' | 'attempted'
}

const INTENT_NAME = 'enterprise-package-update-intent.json'
const MAX_INTENT_BYTES = 2048
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)

  return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

export function supportsEnterpriseNsis(options: EnterprisePackageUpdaterOptions): boolean {
  if (!options.isPackaged || (options.platform ?? process.platform) !== 'win32' || (options.arch ?? process.arch) !== 'x64') {return false}

  try {
    const file = path.join(options.resourcesPath, 'enterprise-nsis-install.json')
    const stat = lstatSync(file)

    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) {return false}
    const marker = JSON.parse(readFileSync(file, 'utf8'))

    return marker.schemaVersion === 1 && marker.installer === 'nsis' && marker.appId === ENTERPRISE_PACKAGE_APP_ID
  } catch { return false }
}

/** Rehash the library-selected regular EXE. Intent never supplies an executable path. */
export async function verifyEnterpriseInstaller(location: PackageDownloadLocation, expectedHash: string): Promise<string> {
  const base = path.resolve(location.baseCacheRoot)
  const root = path.resolve(location.cacheRoot)
  const file = path.resolve(location.file)

  if (!within(base, root) || path.dirname(root) !== base || !within(root, file) || path.dirname(file) !== path.join(root, 'pending') || path.extname(file).toLowerCase() !== '.exe') {
    throw new Error('unsafe-cache-path')
  }

  // lstat each segment prevents Windows directory junctions and symbolic links
  // from making a syntactically safe cache resolve somewhere else.
  for (const candidate of [root, path.dirname(file), file]) {
    const stat = await fs.lstat(candidate)

    if (stat.isSymbolicLink() || (candidate === file ? !stat.isFile() : !stat.isDirectory())) {throw new Error('unsafe-cache-file')}
  }

  const realBase = await fs.realpath(base)
  const realFile = await fs.realpath(file)
  const realRoot = await fs.realpath(root)

  if (!within(realBase, realRoot) || !within(realRoot, realFile) || path.relative(realRoot, realFile) !== path.join('pending', path.basename(file))) {throw new Error('unsafe-cache-realpath')}
  const handle = await fs.open(file, 'r')

  try {
    const before = await handle.stat()

    if (!before.isFile() || before.size < 2 || before.size > MAX_INSTALLER_BYTES) {throw new Error('invalid-installer')}
    const header = Buffer.alloc(2)
    await handle.read(header, 0, 2, 0)

    if (header.toString('ascii') !== 'MZ') {throw new Error('invalid-executable')}
    const hash = createHash('sha512')
    const stream = handle.createReadStream({ start: 0, autoClose: false })

    for await (const chunk of stream) {hash.update(chunk)}
    const actual = hash.digest()
    const expected = Buffer.from(expectedHash, 'base64')
    const after = await handle.stat()
    const pathStat = await fs.lstat(file)

    if (expected.length !== 64 || !timingSafeEqual(actual, expected) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== pathStat.ino || pathStat.isSymbolicLink() || await fs.realpath(file) !== realFile) {
      throw new Error('installer-changed')
    }
  } finally { await handle.close() }

  return file
}

function validIntent(value: unknown): value is UpdateIntent {
  if (!value || typeof value !== 'object') {return false}
  const item = value as UpdateIntent
  const keys = Object.keys(item).sort().join(',')

  return keys === 'arch,attempt,createdAt,mode,schemaVersion,sha512,version'
    && item.schemaVersion === 1 && item.mode === 'next-launch' && item.arch === 'x64'
    && typeof item.version === 'string' && item.version.length <= 80 && Boolean(valid(item.version))
    && typeof item.sha512 === 'string' && item.sha512.length === 88 && Buffer.from(item.sha512, 'base64').length === 64
    && Number.isSafeInteger(item.createdAt) && item.createdAt > 0
    && ['scheduled', 'attempted'].includes(item.attempt)
}

export class EnterprisePackageUpdaterController {
  private state: EnterprisePackageUpdateState
  private listeners = new Set<(state: EnterprisePackageUpdateState) => void>()
  private driver: PackageUpdateDriver | null = null
  private detachProgress: (() => void) | null = null
  private generation = 0
  private running = false
  private disposed = false
  private recovered = false
  private target: PackageUpdateTarget | null = null
  private location: PackageDownloadLocation | null = null
  private intent: UpdateIntent | null = null
  private preparationCleanup = new Map<number, () => void>()

  constructor(private readonly options: EnterprisePackageUpdaterOptions) {
    const supported = supportsEnterpriseNsis(options)
    this.state = { supported, currentVersion: options.currentVersion, phase: supported ? 'idle' : 'unsupported',
      message: supported ? '可检查客户端更新' : '当前安装方式不支持安装包更新', nextLaunchScheduled: false }
  }

  getState(): EnterprisePackageUpdateState { return { ...this.state, reasons: this.state.reasons?.slice() } }
  subscribe(listener: (state: EnterprisePackageUpdateState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())

    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<EnterprisePackageUpdateState>): void {
    if (this.disposed) {return}
    this.state = { ...this.state, reasons: undefined, ...patch }

    for (const listener of this.listeners) { try { listener(this.getState()) } catch { /* UI cannot break native owner. */ } }
  }
  private getDriver(): PackageUpdateDriver {
    if (!this.driver) {
      this.driver = (this.options.driverFactory ?? createNativePackageUpdateDriver)()
      this.detachProgress = this.driver.onProgress(percent => {
        if (this.running && this.state.phase === 'downloading' && Number.isFinite(percent)) {this.publish({ progress: Math.min(100, Math.max(0, percent)) })}
      })
    }

    return this.driver
  }
  private assertCurrent(generation: number, deadline: number): void {
    if (this.disposed || generation !== this.generation || Date.now() >= deadline) {throw new Error('update-expired')}
  }
  private async operate(work: (generation: number, deadline: number) => Promise<void>, timeoutMs?: number): Promise<EnterprisePackageUpdateState> {
    if (this.running || this.disposed || !this.state.supported) {return this.getState()}
    this.running = true
    const generation = ++this.generation
    const limit = timeoutMs ?? this.options.operationTimeoutMs ?? 300_000
    const deadline = Date.now() + limit
    let timer: ReturnType<typeof setTimeout>

    const timedOut = new Promise<void>(resolve => {
      timer = setTimeout(() => {
        this.generation++
        this.driver?.cancel()
        this.preparationCleanup.get(generation)?.()
        this.publish({ phase: 'error', message: '更新处理超时，当前客户端可以继续使用' })
        resolve()
      }, limit)
    })

    try {
      await Promise.race([work(generation, deadline).catch(() => {
        if (generation === this.generation) {this.publish({ phase: 'error', message: '更新未能完成，当前客户端可以继续使用，请重试' })}
      }), timedOut])
    } finally { clearTimeout(timer!); this.running = false }

    return this.getState()
  }
  private async select(generation: number, deadline: number): Promise<PackageUpdateTarget | null> {
    this.publish({ phase: 'checking', message: '正在检查客户端更新', progress: undefined })
    const target = await this.getDriver().check()
    this.assertCurrent(generation, deadline)
    this.target = target
    this.location = null
    this.publish({ phase: target ? 'available' : 'idle', targetVersion: target?.version,
      message: target ? '发现新版本，可更新或先下载' : '当前没有可用的新版本' })

    return target
  }
  private async fetch(generation: number, deadline: number, expected?: PackageUpdateTarget): Promise<boolean> {
    const target = await this.select(generation, deadline)

    if (!target) {return false}

    if (expected && (target.version !== expected.version || target.sha512 !== expected.sha512)) {throw new Error('release-intent-changed')}
    this.publish({ phase: 'downloading', message: '正在下载更新，工作可以继续', progress: 0 })
    const location = await this.getDriver().download()
    this.assertCurrent(generation, deadline)
    await verifyEnterpriseInstaller(location, target.sha512)
    this.assertCurrent(generation, deadline)
    this.location = location
    this.publish({ phase: 'downloaded', message: '更新已下载并校验', progress: 100 })

    return true
  }
  check(): Promise<EnterprisePackageUpdateState> { return this.operate(async (g, d) => { await this.select(g, d) }, 18_000) }
  download(): Promise<EnterprisePackageUpdateState> { return this.operate(async (g, d) => { await this.fetch(g, d) }) }
  installNow(): Promise<EnterprisePackageUpdateState> {
    return this.operate(async (g, d) => { if (await this.fetch(g, d)) {await this.install(g, d, false)} })
  }
  scheduleNextLaunch(): Promise<EnterprisePackageUpdateState> {
    return this.operate(async (g, d) => {
      if (!await this.fetch(g, d)) {return}
      const intent: UpdateIntent = { ...this.target!, schemaVersion: 1, mode: 'next-launch', arch: 'x64', createdAt: Date.now(), attempt: 'scheduled' }
      this.assertCurrent(g, d)
      await this.writeIntent(intent)
      this.assertCurrent(g, d)
      this.intent = intent
      this.publish({ phase: 'scheduled', nextLaunchScheduled: true, message: '已下载，将在下次启动时安装；本次退出不安装' })
    })
  }
  cancelSchedule(): Promise<EnterprisePackageUpdateState> {
    return this.operate(async () => {
      await this.clearIntent()
      this.publish({ nextLaunchScheduled: false, phase: this.location ? 'downloaded' : 'idle', message: '已取消下次启动安装' })
    })
  }
  private get intentPath(): string { return path.join(this.options.userDataPath, INTENT_NAME) }
  private async writeIntent(intent: UpdateIntent): Promise<void> {
    await fs.mkdir(this.options.userDataPath, { recursive: true })
    const temporary = this.intentPath + '.' + randomUUID() + '.tmp'

    try {
      await fs.writeFile(temporary, JSON.stringify(intent), { flag: 'wx', mode: 0o600 })
      await fs.rename(temporary, this.intentPath)
    } finally { await fs.unlink(temporary).catch(() => {}) }
  }
  private async clearIntent(): Promise<void> {
    await fs.unlink(this.intentPath).catch(error => { if (error.code !== 'ENOENT') {throw error} })
    this.intent = null
  }
  private async readIntent(): Promise<UpdateIntent | null> {
    try {
      const stat = await fs.lstat(this.intentPath)

      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INTENT_BYTES) {throw new Error('invalid-intent')}
      const handle = await fs.open(this.intentPath, 'r')
      let text: string

      try {
        const buffer = Buffer.alloc(MAX_INTENT_BYTES + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)

        if (bytesRead > MAX_INTENT_BYTES) {throw new Error('invalid-intent')}
        text = buffer.subarray(0, bytesRead).toString('utf8')
      } finally { await handle.close() }

      const value = JSON.parse(text)

      if (!validIntent(value)) {throw new Error('invalid-intent')}

      return value
    } catch (error) { if (error.code === 'ENOENT') {return null;} throw error }
  }
  recoverOnStartup(): Promise<EnterprisePackageUpdateState> {
    if (this.recovered) {return Promise.resolve(this.getState())}
    this.recovered = true

    return this.operate(async (g, d) => {
      const intent = await this.readIntent()
      this.assertCurrent(g, d)

      if (!intent) {return}

      if (this.options.currentVersion === intent.version || gt(this.options.currentVersion, intent.version)) {
        await this.clearIntent()
        this.publish({ phase: 'idle', message: this.options.currentVersion === intent.version ? '客户端已更新' : '旧更新计划已被当前版本取代' })

        return
      }

      this.intent = intent
      this.publish({ nextLaunchScheduled: true, targetVersion: intent.version })

      if (intent.attempt === 'attempted') {
        this.publish({ phase: 'blocked', message: '上次更新未确认完成，请手动重试；当前客户端可以继续使用' })

        return
      }

      // Persist before network work too: an interrupted startup never loops.
      await this.writeIntent({ ...intent, attempt: 'attempted' })
      this.assertCurrent(g, d)

      if (!await this.fetch(g, d, intent)) {
        this.publish({ phase: 'blocked', message: '原更新已撤回或不可用，请重新检查' })

        return
      }

      await this.install(g, d, true)
    }, Math.min(18_000, this.options.startupTimeoutMs ?? 18_000))
  }
  private async install(generation: number, deadline: number, startup: boolean): Promise<void> {
    if (!this.target || !this.location) {throw new Error('no-installer')}
    const transactionId = randomUUID()
    let lease: EnterprisePackageReadinessLease | null = null
    let handedOffSuccessfully = false
    let released = false

    const release = () => {
      if (!released) { released = true; lease?.release() }
    }

    try {
      this.publish({ phase: 'preparing', message: '正在确认工作已保存并校验安装包' })

      if (!startup) {
        lease = await this.options.prepare(transactionId)
        this.preparationCleanup.set(generation, release)
        this.assertCurrent(generation, deadline)

        if (!lease.ready || !lease.isStillReady()) {
          this.publish({ phase: 'blocked', message: '请先完成或保存当前工作，再安装更新', reasons: lease.reasons?.slice(0, 12) })

          return
        }
      }

      const stillReady = () => !this.disposed && generation === this.generation && Date.now() < deadline && (startup || Boolean(lease?.isStillReady()))

      if (!stillReady() || Date.now() + 2000 >= deadline) {throw new Error('install-window-expired')}
      // Keep an attempt record through handoff; only a new process version proves completion.
      await this.writeIntent({ ...this.target, schemaVersion: 1, mode: 'next-launch', arch: 'x64', createdAt: this.intent?.createdAt ?? Date.now(), attempt: 'attempted' })
      const file = await verifyEnterpriseInstaller(this.location, this.target.sha512)

      if (!stillReady() || Date.now() + 1700 >= deadline) {throw new Error('readiness-changed')}
      this.publish({ phase: 'installing', message: '正在启动更新安装程序' })
      const handedOff = await this.getDriver().handoff(file, stillReady)

      if (!handedOff || !stillReady()) {throw new Error('handoff-failed')}
      this.options.onHandoff(transactionId)
      handedOffSuccessfully = true
    } finally {
      this.preparationCleanup.delete(generation)

      // Successful app.quit tears down asynchronously. Keep all editors frozen
      // through that interval; a failed callback still restores the old app.
      if (!handedOffSuccessfully) {release()}
    }
  }
  dispose(): void {
    this.disposed = true
    this.generation++
    this.driver?.cancel()

    for (const cleanup of this.preparationCleanup.values()) {cleanup()}
    this.preparationCleanup.clear()
    this.detachProgress?.()
    this.driver?.dispose()
    this.listeners.clear()
  }
}

export function createEnterprisePackageUpdater(options: EnterprisePackageUpdaterOptions): EnterprisePackageUpdaterController {
  return new EnterprisePackageUpdaterController(options)
}
