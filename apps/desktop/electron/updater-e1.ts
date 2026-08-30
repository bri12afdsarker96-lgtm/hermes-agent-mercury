'use strict'

/**
 * updater-e1.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-02 · Line B REMEDIATION-01
 *
 * REAL runtime composition for the official electron-updater seam
 * (REMEDIATION-01 §4/§7/§8/§9/§10/§11/§13).
 *
 * What this module is:
 *   - A small, bounded main-process adapter that wires the official
 *     `electron-updater` AppUpdater into the E1 state contract
 *     (update-state-channel.ts envelope).
 *   - Source/dev vs packaged classification: in dev, this module is a
 *     no-op — the existing Hermes source/git updater flow is untouched.
 *   - DI-first: every external dependency (app updater, clock, emitter,
 *     audit sink, config) is injectable. Tests inject a fake.
 *   - Restart-install gating delegates to the pure evaluator in
 *     update-restart-install.ts. The adapter does NOT invent its own
 *     gate logic.
 *
 * What this module is NOT:
 *   - Not a replacement for `update-gate.ts`, `update-marker.ts`, or
 *     `updater-process.ts` (REMEDIATION-01 §21 — do not duplicate).
 *   - Not a renderer UI surface (REMEDIATION-01 §12 — main-only).
 *   - Not a real production updater — `updates.example.invalid` is a
 *     synthetic feed and is flagged NOT_AUTHORIZED in package.json
 *     (REMEDIATION-01 §17).
 *   - Not an E2 / V1→successor proof (REMEDIATION-01 §31 — out of scope).
 */

import type { EventEmitter } from 'node:events'

import type * as ElectronUpdater from 'electron-updater'
import type { AppUpdater as ElectronAppUpdater } from 'electron-updater'

import {
  isV1ShippableChannel,
  resolveUpdateChannel,
  type UpdateChannelName,
} from './update-channel'
import {
  MINIMUM_SUPPORTED_VERSION_POLICY,
  MINIMUM_VERSION,
  V1_SHIPPABLE_CHANNEL,
} from './update-policy'
import {
  evaluateRestartInstall,
  recordRestartAuditEvent,
  type RestartAuditEvent,
  type RestartInstallInput,
} from './update-restart-install'
import type {
  NOT_ESTABLISHED_MINIMUM_VERSION} from './update-state-channel';
import {
  makeUpdateEnvelope,
  type MinimumVersionPolicy,
  UPDATE_STATE_CHANNEL,
  type UpdateErrorClass,
  type UpdateStateEnvelope,
} from './update-state-channel'

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

/** Minimal surface of electron-updater's AppUpdater used by the adapter. */
export interface AppUpdaterLike extends EventEmitter {
  channel: string | null
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  setFeedURL(options: { provider?: string; url?: string; channel?: string | null }): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

/** Minimal app.isPackaged / app.getVersion() surface for DI. */
export interface AppLike {
  isPackaged: boolean
  getVersion(): string
}

/** A real instance of AppUpdater — built lazily on first initialize(). */
export type AppUpdaterFactory = () => ElectronAppUpdater

/** Default factory: dynamic-import electron-updater and build AppUpdater. */
export const defaultAppUpdaterFactory: AppUpdaterFactory = () => {
  // Lazy require so this module stays test-friendly.
  // electron-updater is a CJS module; use require for compatibility.

  const electronUpdater: typeof ElectronUpdater = require('electron-updater')
  const { autoUpdater } = electronUpdater

  return autoUpdater
}

/** Configuration seam for the runtime. */
export interface UpdaterE1Config {
  /** Current product version (e.g. app.getVersion()). */
  currentVersion: string
  /**
   * Channel policy — by default, resolved from process.env
   * (HERMES_UPDATE_CHANNEL). Tests may inject directly.
   */
  channel?: UpdateChannelName
  /** Minimum-version policy. Default: read from update-policy.ts. */
  minimumVersionPolicy?: MinimumVersionPolicy
  /** Minimum-version string. Default: read from update-policy.ts. */
  minimumVersion?: string | typeof NOT_ESTABLISHED_MINIMUM_VERSION
  /**
   * Feed URL for the publish contract. Default: read from
   * `build.publish.url` in package.json (validated by caller).
   * Set to null to disable feed wiring.
   */
  feedUrl?: string | null
  /**
   * Whether to wire the AppUpdater in the current process. Defaults to
   * `app.isPackaged`. Dev/source runs MUST return a "disabled" runtime
   * (REMEDIATION-01 §9).
   */
  enabled?: boolean
}

export interface UpdaterE1Deps {
  app: AppLike
  /** Factory for AppUpdater. Inject a fake in tests. */
  appUpdaterFactory?: AppUpdaterFactory
  /** State-emitter sink (the IPC bridge to the renderer). */
  emitState: (envelope: UpdateStateEnvelope) => void
  /** Audit-event sink. Default: no-op (E2 contract lands later). */
  audit?: (event: RestartAuditEvent | AuditEvent) => void
  /** Wall clock for testing. */
  clock?: () => number
  /** Inject a fake AppUpdater post-construction (tests only). */
  setAppUpdaterForTesting?: (updater: AppUpdaterLike) => void
}

export interface AuditEvent {
  event:
    | 'update.check.started'
    | 'update.available'
    | 'update.not-available'
    | 'update.download.started'
    | 'update.download.progress'
    | 'update.downloaded'
    | 'update.error'
    | 'update.bootstrap.disabled'
  ts: number
  [k: string]: unknown
}

/** Runtime status returned by initialize(). */
export type UpdaterE1InitResult =
  | { kind: 'initialized'; reason: 'ok' }
  | { kind: 'disabled'; reason: 'dev' | 'feed-missing' | 'feed-invalid' | 'app-not-packaged' }
  | { kind: 'error'; reason: string }

/** A snapshot of the most recent authoritative state for restart-install. */
export interface UpdaterE1State {
  /** True when the latest authoritative updater event was "downloaded". */
  isDownloaded: boolean
  /** Resolved channel at init time. */
  channel: UpdateChannelName
  /** Configured feed URL, or null. */
  feedUrl: string | null
  /** Whether the runtime was wired (true) or disabled (false). */
  enabled: boolean
  /** Current installed version. */
  currentVersion: string
  /** Latest known available version (if reported by the updater). */
  availableVersion: string | null
}

// ────────────────────────────────────────────────────────────────────────────
// Adapter
// ────────────────────────────────────────────────────────────────────────────

const PROGRESS_MIN = 0
const PROGRESS_MAX = 1

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {return PROGRESS_MIN}

  if (value < PROGRESS_MIN) {return PROGRESS_MIN}

  if (value > PROGRESS_MAX) {return PROGRESS_MAX}

  return value
}

function classifyError(err: unknown): UpdateErrorClass {
  if (!err || typeof err !== 'object') {return 'unknown'}
  const message = String((err as { message?: unknown }).message ?? '').toLowerCase()

  if (message.includes('econnrefused') || message.includes('enotfound') || message.includes('network')) {
    return 'network'
  }

  if (message.includes('signature') || message.includes('verify')) {
    return 'signature'
  }

  if (message.includes('disk') || message.includes('enospc')) {
    return 'disk-space'
  }

  if (message.includes('cancel')) {
    return 'cancelled'
  }

  if (message.includes('channel')) {
    return 'channel-mismatch'
  }

  return 'unknown'
}

export class UpdaterE1Runtime {
  private readonly deps: UpdaterE1Deps
  private readonly config: Required<Omit<UpdaterE1Config, 'channel' | 'feedUrl' | 'enabled'>> & {
    channel: UpdateChannelName
    feedUrl: string | null
    enabled: boolean
  }
  private appUpdater: AppUpdaterLike | null = null
  private appUpdaterWired = false
  private initialized = false
  private latest: UpdaterE1State
  private readonly boundHandlers: Map<string, (...args: unknown[]) => void> = new Map()

  constructor(deps: UpdaterE1Deps, config: UpdaterE1Config) {
    this.deps = deps

    const resolvedChannel: UpdateChannelName =
      config.channel ??
      resolveUpdateChannel(process.env).name

    const minimumVersionPolicy = config.minimumVersionPolicy ?? MINIMUM_SUPPORTED_VERSION_POLICY
    const minimumVersion = config.minimumVersion ?? MINIMUM_VERSION
    const feedUrl = config.feedUrl === undefined ? readFeedUrlFromPackage() : config.feedUrl
    const enabled = config.enabled ?? deps.app.isPackaged
    this.config = {
      currentVersion: config.currentVersion || deps.app.getVersion(),
      minimumVersionPolicy,
      minimumVersion,
      channel: resolvedChannel,
      feedUrl,
      enabled,
    }
    this.latest = {
      isDownloaded: false,
      channel: this.config.channel,
      feedUrl: this.config.feedUrl,
      enabled: this.config.enabled,
      currentVersion: this.config.currentVersion,
      availableVersion: null,
    }
  }

  /** Lazy-init the AppUpdater + bind events. Idempotent. */
  initialize(): UpdaterE1InitResult {
    if (this.initialized) {return { kind: 'initialized', reason: 'ok' }}
    this.initialized = true

    if (!this.config.enabled) {
      const reason: 'dev' | 'app-not-packaged' = this.deps.app.isPackaged ? 'dev' : 'app-not-packaged'
      this.deps.audit?.({
        event: 'update.bootstrap.disabled',
        ts: this.now(),
        reason,
      })
      this.deps.emitState(
        makeUpdateEnvelope({ phase: 'idle', channel: this.config.channel }),
      )

      return { kind: 'disabled', reason }
    }

    if (!this.config.feedUrl) {
      this.deps.audit?.({
        event: 'update.bootstrap.disabled',
        ts: this.now(),
        reason: 'feed-missing',
      })
      this.deps.emitState(
        makeUpdateEnvelope({ phase: 'idle', channel: this.config.channel, errorClass: 'unknown' }),
      )

      return { kind: 'disabled', reason: 'feed-missing' }
    }

    // REMEDIATION-01 §17: a synthetic .invalid URL is allowed for E1 but
    // must NOT be treated as a production feed. Detect the canonical
    // placeholder TLD anywhere in the URL (path may have /channel suffix).
    const url = this.config.feedUrl

    const isInvalidFeed =
      /(^|\.)invalid(\/|$)/i.test(url) || !/^https?:\/\//i.test(url)

    if (isInvalidFeed) {
      this.deps.audit?.({
        event: 'update.bootstrap.disabled',
        ts: this.now(),
        reason: 'feed-invalid',
        feedUrl: this.config.feedUrl,
      })
      this.deps.emitState(
        makeUpdateEnvelope({ phase: 'idle', channel: this.config.channel, errorClass: 'unknown' }),
      )

      return { kind: 'disabled', reason: 'feed-invalid' }
    }

    // V1 channel guard (REMEDIATION-01 §14) — must never accept
    // beta/internal even if feed URL parses. The runtime is still
    // queryable; only the AppUpdater wiring is skipped.
    if (!isV1ShippableChannel(this.config.channel)) {
      this.deps.audit?.({
        event: 'update.bootstrap.disabled',
        ts: this.now(),
        reason: 'channel-not-v1-shippable',
        channel: this.config.channel,
      })
      this.deps.emitState(
        makeUpdateEnvelope({
          phase: 'idle',
          channel: this.config.channel,
          errorClass: 'channel-mismatch',
        }),
      )
      // Surface a sentinel state: appUpdater stays null, but the
      // runtime is queryable so requestRestartInstall can fail-closed.
      this.appUpdaterWired = false

      return { kind: 'initialized', reason: 'ok' }
    }

    const factory = this.deps.appUpdaterFactory ?? defaultAppUpdaterFactory

    try {
      const real = factory()
      this.appUpdater = real as unknown as AppUpdaterLike
    } catch (err) {
      return {
        kind: 'error',
        reason: `appUpdater factory failed: ${(err as Error).message ?? String(err)}`,
      }
    }

    if (this.deps.setAppUpdaterForTesting) {
      this.deps.setAppUpdaterForTesting(this.appUpdater)
    }

    this.bindEvents()

    try {
      this.appUpdater.setFeedURL({
        provider: 'generic',
        url: this.config.feedUrl ?? undefined,
        channel: this.config.channel,
      })
    } catch (err) {
      return {
        kind: 'error',
        reason: `setFeedURL failed: ${(err as Error).message ?? String(err)}`,
      }
    }

    this.appUpdaterWired = true

    return { kind: 'initialized', reason: 'ok' }
  }

  /** Snapshot for the renderer / restart-install callers. */
  getState(): UpdaterE1State {
    return { ...this.latest }
  }

  /** Trigger an authoritative check. */
  async check(): Promise<UpdateStateEnvelope> {
    this.ensureInitialized()
    this.deps.emitState(makeUpdateEnvelope({ phase: 'checking', channel: this.config.channel }))
    this.deps.audit?.({ event: 'update.check.started', ts: this.now(), channel: this.config.channel })

    try {
      await this.appUpdater!.checkForUpdates()
    } catch (err) {
      this.emitError(err)
    }

    // The real envelopes are emitted by the event handlers; this call
    // returns the "checking" envelope as a return value for callers that
    // want synchronous-ish feedback.
    return makeUpdateEnvelope({ phase: 'checking', channel: this.config.channel })
  }

  /** Trigger a real download (after `update-available`). */
  async download(): Promise<void> {
    this.ensureInitialized()
    this.deps.emitState(
      makeUpdateEnvelope({ phase: 'downloading', channel: this.config.channel, progress: 0 }),
    )
    this.deps.audit?.({
      event: 'update.download.started',
      ts: this.now(),
      channel: this.config.channel,
    })

    try {
      await this.appUpdater!.downloadUpdate()
    } catch (err) {
      this.emitError(err)
      throw err
    }
  }

  /**
   * Authoritative restart-install. Returns the E1 envelope and only calls
   * the underlying `quitAndInstall()` when:
   *   - state is `downloaded` (REMEDIATION-01 §13),
   *   - channel is V1-shippable (REMEDIATION-01 §14),
   *   - minimum-version gate passes (REMEDIATION-01 §15),
   *   - safeStorage / userData are preserved (REMEDIATION-01 §20),
   *   - caller supplies userConfirmed=true.
   */
  async requestRestartInstall(input: {
    userConfirmed: boolean
    safeStoragePreserved: boolean
    hasPendingMutations: boolean
  }): Promise<UpdateStateEnvelope> {
    this.ensureInitialized()

    const decision = evaluateRestartInstall({
      channel: this.config.channel,
      currentVersion: this.config.currentVersion,
      minimumVersion: this.config.minimumVersion,
      hasPendingMutations: input.hasPendingMutations,
      safeStoragePreserved: input.safeStoragePreserved,
      userConfirmed: input.userConfirmed,
    } satisfies RestartInstallInput)

    if (decision.ok === false) {
      // Fail-closed — no install, no audit, but a clear error envelope.
      return makeUpdateEnvelope({
        phase: 'error',
        channel: this.config.channel,
        errorClass: classifyByGate(decision.failedGate),
        errorCode: decision.failedGate,
      })
    }

    // De-duplicate: only one install call per lifetime of the runtime.
    if (this.latest.isDownloaded && (this.appUpdater as unknown as { _installRequested?: boolean })._installRequested) {
      return makeUpdateEnvelope({ phase: 'installing', channel: this.config.channel, restartPending: true })
    }

    ;(this.appUpdater as unknown as { _installRequested?: boolean })._installRequested = true

    this.deps.audit?.(
      recordRestartAuditEvent(
        {
          channel: this.config.channel,
          currentVersion: this.config.currentVersion,
          minimumVersion: this.config.minimumVersion,
          hasPendingMutations: input.hasPendingMutations,
          safeStoragePreserved: input.safeStoragePreserved,
          userConfirmed: input.userConfirmed,
        },
        decision,
      ),
    )

    try {
      this.appUpdater!.quitAndInstall()
    } catch (err) {
      this.emitError(err)
      throw err
    }

    return makeUpdateEnvelope({
      phase: 'installing',
      channel: this.config.channel,
      restartPending: true,
    })
  }

  /** Detach listeners — call before app.quit() to avoid leaks. */
  dispose(): void {
    if (!this.appUpdater) {return}

    for (const [event, handler] of this.boundHandlers) {
      this.appUpdater.removeListener(event, handler as (...args: unknown[]) => void)
    }

    this.boundHandlers.clear()
  }

  // ────────────────────────────────────────────────────────────────────────
  // Internal
  // ────────────────────────────────────────────────────────────────────────

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now()
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[updater-e1] runtime not initialized (call initialize() first)')
    }

    if (!this.appUpdaterWired || !this.appUpdater) {
      throw new Error('[updater-e1] AppUpdater not wired (channel not V1-shippable or feed invalid)')
    }
  }

  private bindEvents(): void {
    if (!this.appUpdater) {return}

    const onChecking = (): void => {
      this.deps.emitState(
        makeUpdateEnvelope({ phase: 'checking', channel: this.config.channel }),
      )
    }

    const onUpdateAvailable = (info: { version?: string }): void => {
      this.latest.availableVersion = info?.version ?? null
      this.deps.emitState(
        makeUpdateEnvelope({
          phase: 'available',
          channel: this.config.channel,
          availableVersion: info?.version,
        }),
      )
      this.deps.audit?.({
        event: 'update.available',
        ts: this.now(),
        availableVersion: info?.version ?? null,
      })
    }

    const onUpdateNotAvailable = (): void => {
      this.deps.emitState(
        makeUpdateEnvelope({ phase: 'idle', channel: this.config.channel }),
      )
      this.deps.audit?.({ event: 'update.not-available', ts: this.now() })
    }

    const onDownloadProgress = (progress: { percent?: number; transferred?: number; total?: number }): void => {
      const raw = typeof progress?.percent === 'number' ? progress.percent / 100 : Number.NaN
      const clamped = clampProgress(raw)
      this.deps.emitState(
        makeUpdateEnvelope({
          phase: 'downloading',
          channel: this.config.channel,
          progress: clamped,
          bytesDownloaded: progress?.transferred,
          bytesTotal: progress?.total,
        }),
      )
      this.deps.audit?.({
        event: 'update.download.progress',
        ts: this.now(),
        progress: clamped,
      })
    }

    const onDownloaded = (info: { version?: string }): void => {
      this.latest.isDownloaded = true
      this.latest.availableVersion = info?.version ?? this.latest.availableVersion
      this.deps.emitState(
        makeUpdateEnvelope({
          phase: 'downloaded',
          channel: this.config.channel,
          availableVersion: info?.version,
          restartPending: false,
        }),
      )
      this.deps.audit?.({
        event: 'update.downloaded',
        ts: this.now(),
        availableVersion: info?.version ?? null,
      })
    }

    const onError = (err: unknown): void => {
      this.emitError(err)
    }

    this.attach('checking-for-update', onChecking)
    this.attach('update-available', onUpdateAvailable)
    this.attach('update-not-available', onUpdateNotAvailable)
    this.attach('download-progress', onDownloadProgress)
    this.attach('update-downloaded', onDownloaded)
    this.attach('error', onError)
  }

  private attach(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.appUpdater) {return}
    this.appUpdater.on(event, handler)
    this.boundHandlers.set(event, handler)
  }

  private emitError(err: unknown): void {
    const errorClass = classifyError(err)
    const errorCode = (err as { code?: unknown })?.code
    const message = (err as { message?: unknown })?.message
    this.deps.emitState(
      makeUpdateEnvelope({
        phase: 'error',
        channel: this.config.channel,
        errorClass,
        errorCode: typeof errorCode === 'string' ? errorCode : undefined,
      }),
    )
    this.deps.audit?.({
      event: 'update.error',
      ts: this.now(),
      errorClass,
      errorCode: typeof errorCode === 'string' ? errorCode : null,
      message: typeof message === 'string' ? message : null,
    })
  }
}

function classifyByGate(gate: string): UpdateErrorClass {
  switch (gate) {
    case 'channel-resolved':

    case 'v1-shippable-channel':
      return 'channel-mismatch'

    case 'minimum-version':
      return 'minimum-version'

    case 'no-pending-mutations':
      return 'cancelled'

    case 'safeStorage-preserved':
      return 'signature'

    case 'user-confirmed':
      return 'cancelled'

    default:
      return 'unknown'
  }
}

function readFeedUrlFromPackage(): string | null {
  try {
     
    const pkg = require('../../package.json') as {
      build?: { publish?: { url?: string } }
    }

    return pkg?.build?.publish?.url ?? null
  } catch {
    return null
  }
}

/** Build the canonical IPC envelope factory bound to a channel constant. */
export const UPDATE_STATE_CHANNEL_NAME = UPDATE_STATE_CHANNEL

export const V1_SHIPPABLE_CHANNEL_CONSTANT = V1_SHIPPABLE_CHANNEL
