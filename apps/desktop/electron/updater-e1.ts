'use strict'

/**
 * updater-e1.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-02 · Line B REMEDIATION-02
 *
 * REAL runtime composition for the official electron-updater seam. This
 * module is the SOLE writer of AppUpdater interactions in the E1 runtime;
 * nothing else in this Lane or any other Lane may directly import
 * `electron-updater` outside of the factory below.
 *
 * REMEDIATION-02 invariants (P9 §B-R2-01 .. §B-R2-16):
 *   - Authoritative Download Gate: restart-install refused unless the
 *     upstream AppUpdater has actually emitted `update-downloaded`
 *     (B-R2-01).
 *   - Idempotent failure: factory / setFeedURL errors and disabled-bootstrap
 *     conditions do NOT silently flip to `initialized/ok` on repeat
 *     initialize() calls (B-R2-05, B-R2-06, B-R2-07).
 *   - Channel truth: beta / internal channels return `kind=disabled,
 *     reason=channel-not-v1-shippable` — never `initialized/ok` with
 *     unwired AppUpdater (B-R2-08).
 *   - Runtime enabled truth: `getState().enabled` reflects whether the
 *     AppUpdater is actually wired and ready, not merely configured
 *     (B-R2-09).
 *   - Bootstrap package metadata path: when no `feedUrl` is provided to
 *     the constructor, the runtime reads from `apps/desktop/package.json`
 *     via a path relative to this file (NOT the repo root) (B-R2-04).
 *   - check() / download() failure truth: an authoritative error envelope
 *     is emitted and the method returns an error envelope (or throws
 *     after emitting one) — never a `checking`/`downloading` envelope
 *     after the failure is known (B-R2-10, B-R2-11).
 *   - Audit secret safety: audit events never carry raw feed URLs, raw
 *     error messages, or credential substrings (B-R2-12).
 *   - Existing source updater preservation: update-gate, update-marker,
 *     updater-process, and the existing applyUpdates flow are NOT
 *     touched by this module (B-R2-14).
 *   - Product identity preservation: this module does not read or
 *     mutate appId / productName / protocol / userData / install scope
 *     (B-R2-15).
 */

import type { EventEmitter } from 'node:events'
import * as path from 'node:path'

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

/** Minimal app.isPackaged / app.getVersion() / app.getAppPath() surface for DI. */
export interface AppLike {
  isPackaged: boolean
  getVersion(): string
  /**
   * Returns the application root directory. In production this is the
   * Electron `app.getAppPath()` value; in source-mode tests any
   * directory may be injected. Per REMEDIATION-03 §P5.3 the runtime uses
   * this to resolve `apps/desktop/package.json` without depending on
   * bare `__dirname` (which is undefined in the bundled ESM main).
   *
   * Optional for backwards compatibility with the REMEDIATION-02
   * AppLike; if absent the runtime falls back to a best-effort lookup
   * that works in vitest source mode but is explicitly documented as
   * NOT safe in packaged production.
   */
  getAppPath?(): string
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
   * `build.publish.url` in `apps/desktop/package.json` (validated by caller).
   * Set to null to force feed-missing classification.
   */
  feedUrl?: string | null
  /**
   * Whether to wire the AppUpdater in the current process. Defaults to
   * `app.isPackaged`. Dev/source runs MUST return a "disabled" runtime
   * (REMEDIATION-02 §9).
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
  /**
   * Test-only hook invoked with the wired AppUpdater after initialize().
   * NOT used in production. Provided for tests that want to inspect the
   * wired instance without going through the factory.
   */
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
    | 'update.install.requested'
    | 'update.install.declined'
    | 'update.install.completed'
  ts: number
  [k: string]: unknown
}

/** Runtime status returned by initialize(). */
export type UpdaterE1InitResult =
  | { kind: 'initialized'; reason: 'ok' }
  | {
      kind: 'disabled'
      reason:
        | 'dev'
        | 'feed-missing'
        | 'feed-invalid'
        | 'app-not-packaged'
        | 'channel-not-v1-shippable'
    }
  | { kind: 'error'; reason: string }

/** A snapshot of the most recent authoritative state for restart-install. */
export interface UpdaterE1State {
  /** True when the latest authoritative updater event was "downloaded". */
  isDownloaded: boolean
  /** Resolved channel at init time. */
  channel: UpdateChannelName
  /** Configured feed URL, or null. */
  feedUrl: string | null
  /**
   * True iff the AppUpdater is actually wired AND ready to be asked to
   * check / download / install. Distinct from `configuredEnabled` —
   * `enabled` reflects runtime truth, configuration reflects intent.
   */
  enabled: boolean
  /** Whether the host's configuration permitted the wiring attempt. */
  configuredEnabled: boolean
  /** Current installed version. */
  currentVersion: string
  /** Latest known available version (if reported by the updater). */
  availableVersion: string | null
  /** Reason returned by the last initialize() call, for diagnostics. */
  initKind: 'initialized' | 'disabled' | 'error' | 'pending'
  initReason: string | null
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
  private readonly config: {
    currentVersion: string
    minimumVersionPolicy: MinimumVersionPolicy
    minimumVersion: string | typeof NOT_ESTABLISHED_MINIMUM_VERSION
    channel: UpdateChannelName
    feedUrl: string | null
    configuredEnabled: boolean
  }
  private appUpdater: AppUpdaterLike | null = null
  private appUpdaterWired = false
  /**
   * initialize() result cache — REMEDIATION-02 §B-R2-05 / §B-R2-06 /
   * §B-R2-07 / §B-R2-08 require that subsequent initialize() calls
   * preserve the truthful classification of the first call. We do this
   * by storing the first result and replaying it.
   */
  private initResult: UpdaterE1InitResult | null = null
  /** True once a successful `quitAndInstall` has been issued (B-R2-03). */
  private installRequested = false
  private latest: UpdaterE1State
  private readonly boundHandlers: Map<string, (...args: unknown[]) => void> = new Map()

  constructor(deps: UpdaterE1Deps, config: UpdaterE1Config) {
    this.deps = deps

    const resolvedChannel: UpdateChannelName =
      config.channel ?? resolveUpdateChannel(process.env).name

    const minimumVersionPolicy = config.minimumVersionPolicy ?? MINIMUM_SUPPORTED_VERSION_POLICY
    const minimumVersion = config.minimumVersion ?? MINIMUM_VERSION

    // B-R2-04: resolve the package metadata feed URL. We first consult
    // the host application's root (Electron `app.getAppPath()` in
    // production — REMEDIATION-03 §P5.3) and only fall back to a
    // `__dirname`-based lookup when no host root is available (vitest
    // source mode and ad-hoc scripts).
    const feedUrl =
      config.feedUrl === undefined ? readFeedUrlFromHost(deps) : config.feedUrl

    const configuredEnabled = config.enabled ?? deps.app.isPackaged
    this.config = {
      currentVersion: config.currentVersion || deps.app.getVersion(),
      minimumVersionPolicy,
      minimumVersion,
      channel: resolvedChannel,
      feedUrl,
      configuredEnabled,
    }
    this.latest = {
      isDownloaded: false,
      channel: this.config.channel,
      feedUrl: this.config.feedUrl,
      enabled: false,
      configuredEnabled: this.config.configuredEnabled,
      currentVersion: this.config.currentVersion,
      availableVersion: null,
      initKind: 'pending',
      initReason: null,
    }
  }

  /**
   * Lazy-init the AppUpdater + bind events. Idempotent across all
   * classifications — a disabled bootstrap stays disabled, an error
   * stays an error (B-R2-05 / B-R2-06 / B-R2-07).
   */
  initialize(): UpdaterE1InitResult {
    if (this.initResult !== null) {
      // Replay the first, truthful classification.
      return this.initResult
    }

    let result: UpdaterE1InitResult

    if (!this.config.configuredEnabled) {
      const reason: 'dev' | 'app-not-packaged' = this.deps.app.isPackaged
        ? 'dev'
        : 'app-not-packaged'

      this.deps.audit?.({
        event: 'update.bootstrap.disabled',
        ts: this.now(),
        reason,
      })
      this.deps.emitState(
        makeUpdateEnvelope({ phase: 'idle', channel: this.config.channel }),
      )
      result = { kind: 'disabled', reason }
    } else if (!this.config.feedUrl) {
      this.deps.audit?.({
        event: 'update.bootstrap.disabled',
        ts: this.now(),
        reason: 'feed-missing',
      })
      this.deps.emitState(
        makeUpdateEnvelope({
          phase: 'idle',
          channel: this.config.channel,
          errorClass: 'unknown',
        }),
      )
      result = { kind: 'disabled', reason: 'feed-missing' }
    } else if (isInvalidFeed(this.config.feedUrl)) {
      this.deps.audit?.({
        event: 'update.bootstrap.disabled',
        ts: this.now(),
        reason: 'feed-invalid',
      })
      this.deps.emitState(
        makeUpdateEnvelope({
          phase: 'idle',
          channel: this.config.channel,
          errorClass: 'unknown',
        }),
      )
      result = { kind: 'disabled', reason: 'feed-invalid' }
    } else if (!isV1ShippableChannel(this.config.channel)) {
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
      result = { kind: 'disabled', reason: 'channel-not-v1-shippable' }
    } else {
      const factory = this.deps.appUpdaterFactory ?? defaultAppUpdaterFactory
      let real: ElectronAppUpdater

      try {
        real = factory()
      } catch (err) {
        result = {
          kind: 'error',
          reason: `appUpdater factory failed: ${(err as Error).message ?? String(err)}`,
        }
        this.initResult = result
        this.recordInitState(result)

        return result
      }

      this.appUpdater = real as unknown as AppUpdaterLike

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
        result = {
          kind: 'error',
          reason: `setFeedURL failed: ${(err as Error).message ?? String(err)}`,
        }
        this.initResult = result
        this.recordInitState(result)

        return result
      }

      this.appUpdaterWired = true
      result = { kind: 'initialized', reason: 'ok' }
    }

    this.initResult = result
    this.recordInitState(result)

    return result
  }

  /** Snapshot for the renderer / restart-install callers. */
  getState(): UpdaterE1State {
    return { ...this.latest }
  }

  /** Trigger an authoritative check. */
  async check(): Promise<UpdateStateEnvelope> {
    this.ensureInitializedAndWired()
    let lastError: unknown = null
    this.deps.emitState(makeUpdateEnvelope({ phase: 'checking', channel: this.config.channel }))
    this.deps.audit?.({
      event: 'update.check.started',
      ts: this.now(),
      channel: this.config.channel,
    })

    try {
      await this.appUpdater!.checkForUpdates()
    } catch (err) {
      lastError = err
      this.emitError(err)
    }

    if (lastError !== null) {
      // Authoritative failure → return error envelope, not checking (B-R2-10).
      return makeUpdateEnvelope({
        phase: 'error',
        channel: this.config.channel,
        errorClass: classifyError(lastError),
      })
    }

    return makeUpdateEnvelope({ phase: 'checking', channel: this.config.channel })
  }

  /** Trigger a real download (after `update-available`). */
  async download(): Promise<void> {
    this.ensureInitializedAndWired()
    let lastError: unknown = null
    this.deps.emitState(
      makeUpdateEnvelope({
        phase: 'downloading',
        channel: this.config.channel,
        progress: 0,
      }),
    )
    this.deps.audit?.({
      event: 'update.download.started',
      ts: this.now(),
      channel: this.config.channel,
    })

    try {
      await this.appUpdater!.downloadUpdate()
    } catch (err) {
      lastError = err
      this.emitError(err)
    }

    if (lastError !== null) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }
  }

  /**
   * Authoritative restart-install. Returns the E1 envelope and only calls
   * the underlying `quitAndInstall()` when (B-R2-01 / B-R2-02):
   *   - the upstream AppUpdater has emitted `update-downloaded`
   *     (state.isDownloaded === true),
   *   - channel is V1-shippable (REMEDIATION-02 §14),
   *   - minimum-version gate passes (REMEDIATION-02 §15),
   *   - safeStorage / userData preservation is asserted
   *     (REMEDIATION-02 §20),
   *   - caller supplies userConfirmed=true,
   *   - hasPendingMutations=false.
   * B-R2-03: subsequent calls return the same envelope without re-invoking
   * `quitAndInstall`.
   */
  async requestRestartInstall(input: {
    userConfirmed: boolean
    safeStoragePreserved: boolean
    hasPendingMutations: boolean
  }): Promise<UpdateStateEnvelope> {
    // B-R2-01 — Authoritative Download Gate.
    if (!this.latest.isDownloaded) {
      const envelope = makeUpdateEnvelope({
        phase: 'error',
        channel: this.config.channel,
        errorClass: 'unknown',
        errorCode: 'downloaded-authoritative',
      })

      // Per REMEDIATION-03 §P6.1 / §B-R3-06 / §B-R3-07: emit the authoritative
      // error envelope AND the decline audit BEFORE the throw. Observers
      // must be able to see the rejection in state and audit; we do not
      // silently construct an envelope and discard it.
      this.deps.emitState(envelope)

      this.deps.audit?.({
        event: 'update.install.declined',
        ts: this.now(),
        channel: this.config.channel,
        reason: 'downloaded-authoritative',
      })
      // Throw so that the failure is unmissable in callers that ignore
      // envelope phase — matches B-R2-11's download-failure pattern.
      throw new Error(
        '[updater-e1] restart-install refused: downloaded-authoritative (update-downloaded event has not fired)',
      )
    }

    const decision = evaluateRestartInstall({
      channel: this.config.channel,
      currentVersion: this.config.currentVersion,
      minimumVersion: this.config.minimumVersion,
      hasPendingMutations: input.hasPendingMutations,
      safeStoragePreserved: input.safeStoragePreserved,
      userConfirmed: input.userConfirmed,
    } satisfies RestartInstallInput)

    if (decision.ok === false) {
      const envelope = makeUpdateEnvelope({
        phase: 'error',
        channel: this.config.channel,
        errorClass: classifyByGate(decision.failedGate),
        errorCode: decision.failedGate,
      })

      this.deps.audit?.({
        event: 'update.install.declined',
        ts: this.now(),
        channel: this.config.channel,
        gate: decision.failedGate,
        reason: decision.reason,
      })

      return envelope
    }

    // B-R2-03 — De-duplicate: at most one install call per runtime lifetime.
    if (this.installRequested) {
      return makeUpdateEnvelope({
        phase: 'installing',
        channel: this.config.channel,
        restartPending: true,
      })
    }

    this.installRequested = true

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
    this.deps.audit?.({
      event: 'update.install.requested',
      ts: this.now(),
      channel: this.config.channel,
    })

    try {
      this.appUpdater!.quitAndInstall()
      this.deps.audit?.({
        event: 'update.install.completed',
        ts: this.now(),
        channel: this.config.channel,
      })
    } catch (err) {
      // Roll back the de-dup latch so a host retry is possible.
      this.installRequested = false
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

  private recordInitState(result: UpdaterE1InitResult): void {
    this.latest = {
      ...this.latest,
      enabled: this.appUpdaterWired,
      initKind: result.kind,
      initReason: 'reason' in result ? result.reason : null,
    }
  }

  private ensureInitializedAndWired(): void {
    if (this.initResult === null) {
      throw new Error('[updater-e1] runtime not initialized (call initialize() first)')
    }

    if (!this.appUpdaterWired || !this.appUpdater) {
      throw new Error(
        '[updater-e1] AppUpdater not wired (init kind=' +
          this.initResult.kind +
          ')',
      )
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

    const onDownloadProgress = (progress: {
      percent?: number
      transferred?: number
      total?: number
    }): void => {
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

  /**
   * Emit an error envelope and audit event WITHOUT leaking raw error
   * message substrings (B-R2-12). Only structured fields are forwarded.
   */
  private emitError(err: unknown): void {
    const errorClass = classifyError(err)
    const errorCodeRaw = (err as { code?: unknown })?.code

    const errorCode =
      typeof errorCodeRaw === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(errorCodeRaw)
        ? errorCodeRaw
        : undefined

    this.deps.emitState(
      makeUpdateEnvelope({
        phase: 'error',
        channel: this.config.channel,
        errorClass,
        errorCode,
      }),
    )
    this.deps.audit?.({
      event: 'update.error',
      ts: this.now(),
      errorClass,
      errorCode: errorCode ?? null,
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

/**
 * Detect synthetic / invalid feed URLs without leaking the URL into audit
 * logs. A URL is "invalid" if its host ends in `.invalid` (the RFC 6761
 * reserved TLD for placeholder names) or if it is not an http(s) URL.
 */
function isInvalidFeed(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) {return true}

  // Match the literal placeholder TLD anywhere in the URL (host may have
  // port, path may include a channel suffix).
  return /(^|\.)invalid(\/|$)/i.test(url)
}

/**
 * Resolve the package metadata feed URL.
 *
 * REMEDIATION-03 §P5.1 / §P5.3 / §P6 invariants:
 *
 *   PACKAGED RUNTIME TRUTH > VITEST SOURCE-MODE PATH TRUTH
 *   app.getAppPath()  >  cwd guess  >  bare __dirname in bundled ESM
 *
 * 1. PRIMARY: ask the host application for its root via
 *    `deps.app.getAppPath()`. In production this is Electron
 *    `app.getAppPath()`. We then look for a `package.json` directly
 *    inside that root.
 *
 * 2. FALLBACK (source-mode vitest / ad-hoc scripts where the host did
 *    not provide getAppPath): walk up from `__dirname` looking for a
 *    package.json whose `name === 'hermes'` (the Desktop product's own
 *    metadata). This path is documented as NOT safe in the bundled ESM
 *    main — production code MUST provide getAppPath().
 *
 * 3. Distinguishes:
 *      NO DATA                          → null (caller → feed-missing)
 *      REAL apps/desktop package found
 *      + synthetic .invalid publish URL → url (caller → feed-invalid)
 *
 * Per §P6: real package + synthetic URL must be classified feed-invalid,
 * NOT feed-missing.
 */
function readFeedUrlFromHost(deps: UpdaterE1Deps): string | null {
  // Primary: app.getAppPath()
  try {
    if (typeof deps.app.getAppPath === 'function') {
      const appRoot = deps.app.getAppPath()

      if (appRoot) {
        const url = readPublishUrlFromDir(appRoot)

        // Per REMEDIATION-03 §P6 invariants:
        //   app.getAppPath()  >  cwd guess  >  bare __dirname in bundled ESM
        // If the host explicitly provided an app root, we trust it and
        // return its result verbatim. A "no usable metadata" outcome at
        // the host root is honest feed-missing and MUST NOT be rescued
        // by a silent walk-up that would re-introduce the vitest-source-
        // mode path into packaged production.
        if (url !== null) {return url}

        return null // NO DATA → feed-missing per §P6
      }
    }
  } catch {
    // ignore — fall through to fallback
  }

  // Fallback: source-mode walk up from __dirname (vitest / ad-hoc scripts).
  return walkUpForHermesPackage()
}

function readPublishUrlFromDir(dir: string): string | null {
  try {
    const candidate = require(path.join(dir, 'package.json')) as {
      name?: string
      build?: { publish?: { url?: string } }
    }

    if (candidate?.build?.publish?.url) {
      return candidate.build.publish.url
    }
  } catch {
    // not a package.json or unreadable
  }

  return null
}

function walkUpForHermesPackage(): string | null {
  try {
    const startDir =
      typeof __dirname === 'string' && __dirname ? __dirname : process.cwd()

    let dir = startDir

    for (let i = 0; i < 8; i += 1) {
      const url = readPublishUrlFromDir(dir)

      if (url !== null) {
        // Distinguish "hermes" product from any other package.
        try {
          const candidate = require(path.join(dir, 'package.json')) as {
            name?: string
          }

          if (candidate?.name === 'hermes') {return url}
        } catch {
          // ignore — already returned null above
        }
      }

      const parent = path.dirname(dir)

      if (parent === dir) {break}
      dir = parent
    }

    return null
  } catch {
    return null
  }
}

/** Build the canonical IPC envelope factory bound to a channel constant. */
export const UPDATE_STATE_CHANNEL_NAME = UPDATE_STATE_CHANNEL

export const V1_SHIPPABLE_CHANNEL_CONSTANT = V1_SHIPPABLE_CHANNEL
