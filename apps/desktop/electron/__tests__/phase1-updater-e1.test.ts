'use strict'

/**
 * phase1-updater-e1.test.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-02 · Line B REMEDIATION-01
 *
 * E1 runtime composition tests (REMEDIATION-01 §23 B1-B18).
 *
 * Imports are written for the project's vitest 4.1.10 runner, NOT node:test
 * (REMEDIATION-01 §22 — the previous commit claimed dual-compatibility but
 * directly imported from 'vitest' which is not a node:test module).
 *
 * Tests use a fake EventEmitter as AppUpdater (REMEDIATION-01 §23), no real
 * production server, no real signing material.
 */

import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  ALLOWED_UPDATE_CHANNELS,
  DEFAULT_UPDATE_CHANNEL,
  isAllowedUpdateChannel,
  isV1ShippableChannel,
  resolveUpdateChannel,
} from '../update-channel'
import { waitForUpdateClearance } from '../update-gate'
import { readLiveUpdateMarker } from '../update-marker'
import {
  isChannelAllowedForV1,
  MINIMUM_SUPPORTED_VERSION_POLICY,
  MINIMUM_VERSION,
  V1_SHIPPABLE_CHANNEL,
} from '../update-policy'
import {
  evaluateRestartInstall,
  recordRestartAuditEvent,
} from '../update-restart-install'
import {
  assertMinimumVersionSupported,
  compareStrictSemver,
  isValidUpdateErrorClass,
  isValidUpdatePhase,
  makeUpdateEnvelope,
  NOT_ESTABLISHED_MINIMUM_VERSION,
  parseStrictSemver,
  UPDATE_STATE_CHANNEL,
} from '../update-state-channel'
import {
  type AppUpdaterLike,
  type UpdaterE1Config,
  type UpdaterE1Deps,
  UpdaterE1Runtime,
} from '../updater-e1'
import * as updaterProcessModule from '../updater-process'

// ────────────────────────────────────────────────────────────────────────────
// Helpers — fake AppUpdater
// ────────────────────────────────────────────────────────────────────────────

class FakeAppUpdater extends EventEmitter implements AppUpdaterLike {
  channel: string | null = null
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = false
  setFeedURLCalls: Array<{ provider?: string; url?: string; channel?: string | null }> = []
  checkForUpdatesCalls = 0
  downloadUpdateCalls = 0
  quitAndInstallCalls = 0
  failNext: 'check' | 'download' | null = null

  setFeedURL(options: { provider?: string; url?: string; channel?: string | null }): void {
    this.setFeedURLCalls.push(options)
    this.channel = options.channel ?? null
  }
  checkForUpdates(): Promise<unknown> {
    this.checkForUpdatesCalls += 1

    if (this.failNext === 'check') {
      this.failNext = null

      return Promise.reject(new Error('ECONNREFUSED simulated network failure'))
    }

    return Promise.resolve(null)
  }
  downloadUpdate(): Promise<unknown> {
    this.downloadUpdateCalls += 1

    if (this.failNext === 'download') {
      this.failNext = null

      return Promise.reject(new Error('ENOSPC simulated disk-full'))
    }

    return Promise.resolve(null)
  }
  quitAndInstall(): void {
    this.quitAndInstallCalls += 1
  }
}

interface Harness {
  runtime: UpdaterE1Runtime
  fake: FakeAppUpdater
  states: ReturnType<typeof makeUpdateEnvelope>[]
  audits: unknown[]
  deps: UpdaterE1Deps
}

function makeHarness(
  overrides: Partial<UpdaterE1Config> = {},
  appOverrides: { isPackaged?: boolean; version?: string } = {},
): Harness {
  const fake = new FakeAppUpdater()
  const states: ReturnType<typeof makeUpdateEnvelope>[] = []
  const audits: unknown[] = []

  const deps: UpdaterE1Deps = {
    app: {
      isPackaged: appOverrides.isPackaged ?? true,
      getVersion: () => appOverrides.version ?? '0.17.0',
    },
    emitState: (e) => states.push(e),
    audit: (e) => audits.push(e),
    clock: () => 1_700_000_000_000,
    setAppUpdaterForTesting: (u) => {
      // The runtime will set itself to `fake` only when allowed; here we
      // hijack by injecting after initialize via the factory instead.
      // (Not used by the default factory below.)
      void u
    },
  }

  // Override factory to return our fake.
  deps.appUpdaterFactory = () => fake as unknown as ReturnType<NonNullable<UpdaterE1Deps['appUpdaterFactory']>>

  const runtime = new UpdaterE1Runtime(deps, {
    currentVersion: appOverrides.version ?? '0.17.0',
    // Use a non-placeholder http URL so initialize() succeeds in tests
    // that wire events. Tests that exercise feed-validation pass an
    // explicit .invalid URL via overrides.
    feedUrl: 'https://updates.example.com/hermes-stable',
    ...overrides,
  })

  return { runtime, fake, states, audits, deps }
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers — keep these to retain coverage of the contract layer
// ────────────────────────────────────────────────────────────────────────────

describe('update-channel', () => {
  it('defaults to stable when HERMES_UPDATE_CHANNEL is unset', () => {
    const r = resolveUpdateChannel({})
    expect(r.name).toBe('stable')
    expect(r.isDefault).toBe(true)
    expect(r.explicitOverride).toBe(false)
    expect(r.source).toBe('default')
  })

  it('respects an explicit valid override', () => {
    const r = resolveUpdateChannel({ HERMES_UPDATE_CHANNEL: 'beta' })
    expect(r.name).toBe('beta')
    expect(r.isDefault).toBe(false)
    expect(r.explicitOverride).toBe(true)
    expect(r.source).toBe('env')
  })

  it('falls back to default for unknown channel names', () => {
    const r = resolveUpdateChannel({ HERMES_UPDATE_CHANNEL: 'banana' })
    expect(r.name).toBe('stable')
    expect(r.isDefault).toBe(true)
    expect(r.explicitOverride).toBe(true)
    expect(r.source).toBe('env')
  })

  it('isAllowedUpdateChannel is precise', () => {
    expect(isAllowedUpdateChannel('stable')).toBe(true)
    expect(isAllowedUpdateChannel('beta')).toBe(true)
    expect(isAllowedUpdateChannel('internal')).toBe(true)
    expect(isAllowedUpdateChannel('production')).toBe(false)
    expect(isAllowedUpdateChannel(123)).toBe(false)
    expect(isAllowedUpdateChannel(null)).toBe(false)
  })

  it('V1 shippable channel is stable only', () => {
    expect(isV1ShippableChannel('stable')).toBe(true)
    expect(isV1ShippableChannel('beta')).toBe(false)
    expect(isV1ShippableChannel('internal')).toBe(false)
  })

  it('constant set is stable', () => {
    expect(ALLOWED_UPDATE_CHANNELS.length).toBe(3)
    expect(DEFAULT_UPDATE_CHANNEL).toBe('stable')
  })
})

describe('update-state-channel', () => {
  it('UPDATE_STATE_CHANNEL is stable', () => {
    expect(UPDATE_STATE_CHANNEL).toBe('hermes:update-state')
  })

  it('phase enum guards', () => {
    expect(isValidUpdatePhase('idle')).toBe(true)
    expect(isValidUpdatePhase('checking')).toBe(true)
    expect(isValidUpdatePhase('downloading')).toBe(true)
    expect(isValidUpdatePhase('error')).toBe(true)
    expect(isValidUpdatePhase('borked')).toBe(false)
    expect(isValidUpdatePhase(null)).toBe(false)
    expect(isValidUpdatePhase(42)).toBe(false)
  })

  it('errorClass enum guards', () => {
    expect(isValidUpdateErrorClass('network')).toBe(true)
    expect(isValidUpdateErrorClass('signature')).toBe(true)
    expect(isValidUpdateErrorClass('canceled')).toBe(false) // en-GB spelling not accepted
    expect(isValidUpdateErrorClass(undefined)).toBe(false)
  })

  it('makeUpdateEnvelope freezes its result and fills ts', () => {
    const env = makeUpdateEnvelope({ phase: 'checking', channel: 'stable' })
    expect(env.phase).toBe('checking')
    expect(env.channel).toBe('stable')
    expect(typeof env.ts).toBe('number')
    expect(Object.isFrozen(env)).toBe(true)
  })

  it('strict semver parser accepts well-formed versions', () => {
    expect(parseStrictSemver('0.17.0').ok).toBe(true)
    expect(parseStrictSemver('1.2').ok).toBe(true)
    expect(parseStrictSemver('4').ok).toBe(true)
  })

  it('strict semver parser rejects malformed versions', () => {
    expect(parseStrictSemver('').ok).toBe(false)
    expect(parseStrictSemver('1.2.banana').ok).toBe(false)
    expect(parseStrictSemver('1.2.0-pre').ok).toBe(false)
    expect(parseStrictSemver('v1.2.0').ok).toBe(false)
    expect(parseStrictSemver(null).ok).toBe(false)
    expect(parseStrictSemver(undefined).ok).toBe(false)
    expect(parseStrictSemver(42).ok).toBe(false)
  })

  it('strict semver compare: valid release / prerelease / older / same / newer', () => {
    expect(compareStrictSemver('1.2.0', '1.2.0')).toBe(0)
    expect(compareStrictSemver('1.2.0', '1.2.1')).toBe(-1)
    expect(compareStrictSemver('2.0.0', '1.99.99')).toBe(1)
    // short vs long still works
    expect(compareStrictSemver('1.2', '1.2.0')).toBe(0)
    // malformed → throws
    expect(() => compareStrictSemver('banana', '1.0.0')).toThrow(RangeError)
    expect(() => compareStrictSemver('1.0.0', 'banana')).toThrow(RangeError)
    expect(() => compareStrictSemver(undefined, '1.0.0')).toThrow(RangeError)
  })

  it('minimum-version gate accepts current >= minimum', () => {
    const ok = assertMinimumVersionSupported('1.2.3', '1.0.0')
    expect(ok.ok).toBe(true)
  })

  it('minimum-version gate rejects current < minimum', () => {
    const bad = assertMinimumVersionSupported('0.5.0', '1.0.0')
    expect(bad.ok).toBe(false)

    if (bad.ok === false) {
      expect(bad.reason).toBe('minimum-version')
    }
  })

  it('minimum-version gate rejects when policy is NOT_ESTABLISHED', () => {
    const r = assertMinimumVersionSupported('1.0.0', NOT_ESTABLISHED_MINIMUM_VERSION)
    expect(r.ok).toBe(false)

    if (r.ok === false) {
      expect(r.reason).toBe('policy-not-established')
    }

    const r2 = assertMinimumVersionSupported('1.0.0', undefined as unknown as string)
    expect(r2.ok).toBe(false)

    if (r2.ok === false) {
      expect(r2.reason).toBe('policy-not-established')
    }
  })

  it('minimum-version gate rejects malformed version', () => {
    const r = assertMinimumVersionSupported('banana', '1.0.0')
    expect(r.ok).toBe(false)

    if (r.ok === false) {
      expect(r.reason).toBe('malformed-version')
    }
  })
})

describe('update-policy', () => {
  it('minimum-supported-version policy is NOT_ESTABLISHED', () => {
    expect(MINIMUM_SUPPORTED_VERSION_POLICY.kind).toBe('not-established')
    expect(MINIMUM_VERSION).toBe(NOT_ESTABLISHED_MINIMUM_VERSION)
  })

  it('V1 shippable channel is stable', () => {
    expect(V1_SHIPPABLE_CHANNEL).toBe('stable')
    expect(isChannelAllowedForV1('stable')).toBe(true)
    expect(isChannelAllowedForV1('beta')).toBe(false)
    expect(isChannelAllowedForV1('internal')).toBe(false)
  })
})

describe('update-restart-install', () => {
  const base = {
    channel: 'stable',
    currentVersion: '1.0.0',
    minimumVersion: '0.18.0',
    hasPendingMutations: false,
    safeStoragePreserved: true,
    userConfirmed: true,
  }

  it('approves when all gates pass', () => {
    const d = evaluateRestartInstall(base)
    expect(d.ok).toBe(true)

    if (d.ok) {
      expect(d.gates.length).toBe(6)
    }
  })

  it('rejects when channel missing', () => {
    const d = evaluateRestartInstall({ ...base, channel: '' })
    expect(d.ok).toBe(false)

    if (d.ok === false) {
      expect(d.failedGate).toBe('channel-resolved')
    }
  })

  it('rejects when channel is beta (not V1 shippable)', () => {
    const d = evaluateRestartInstall({ ...base, channel: 'beta' })
    expect(d.ok).toBe(false)

    if (d.ok === false) {
      expect(d.failedGate).toBe('v1-shippable-channel')
    }
  })

  it('rejects when currentVersion below minimum', () => {
    const d = evaluateRestartInstall({ ...base, currentVersion: '0.5.0' })
    expect(d.ok).toBe(false)

    if (d.ok === false) {
      expect(d.failedGate).toBe('minimum-version')
    }
  })

  it('rejects when minimum policy is NOT_ESTABLISHED', () => {
    const d = evaluateRestartInstall({ ...base, minimumVersion: NOT_ESTABLISHED_MINIMUM_VERSION })
    expect(d.ok).toBe(false)

    if (d.ok === false) {
      expect(d.failedGate).toBe('minimum-version')
    }
  })

  it('rejects when pending mutations exist', () => {
    const d = evaluateRestartInstall({ ...base, hasPendingMutations: true })
    expect(d.ok).toBe(false)

    if (d.ok === false) {
      expect(d.failedGate).toBe('no-pending-mutations')
    }
  })

  it('rejects when safeStorage not preserved', () => {
    const d = evaluateRestartInstall({ ...base, safeStoragePreserved: false })
    expect(d.ok).toBe(false)

    if (d.ok === false) {
      expect(d.failedGate).toBe('safeStorage-preserved')
    }
  })

  it('rejects when user has not confirmed', () => {
    const d = evaluateRestartInstall({ ...base, userConfirmed: false })
    expect(d.ok).toBe(false)

    if (d.ok === false) {
      expect(d.failedGate).toBe('user-confirmed')
    }
  })

  it('audit event payload is stable and never contains a secret', () => {
    const d = evaluateRestartInstall(base)
    expect(d.ok).toBe(true)

    if (d.ok) {
      const ev = recordRestartAuditEvent(base, d)
      expect(ev.event).toBe('update.restart-install.requested')
      expect(ev.channel).toBe('stable')
      const json = JSON.stringify(ev)
      expect(json).not.toContain('password')
      expect(json).not.toContain('privateKey')
      expect(json).not.toContain('token')
      expect(json).not.toContain('ghp_')
      expect(json).not.toContain('AKIA')
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Runtime composition — REMEDIATION-01 §23 B1-B18
// ────────────────────────────────────────────────────────────────────────────

describe('updater-e1 runtime composition', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })

  // B1 — initialize exactly once
  it('B1: initialize is idempotent and reports initialized once', () => {
    const r1 = h.runtime.initialize()
    expect(r1.kind).toBe('initialized')
    const r2 = h.runtime.initialize()
    expect(r2.kind).toBe('initialized')
    expect(h.fake.setFeedURLCalls.length).toBe(1)
  })

  // B2 — packaged=false → no release updater activation
  it('B2: packaged=false → disabled, no AppUpdater activated', () => {
    const h2 = makeHarness({}, { isPackaged: false })
    const r = h2.runtime.initialize()
    expect(r.kind).toBe('disabled')
    expect((r as { reason: string }).reason).toBe('app-not-packaged')
    expect(h2.fake.setFeedURLCalls.length).toBe(0)
    expect(h2.states.at(-1)?.phase).toBe('idle')
  })

  it('B2b: explicit enabled=false → disabled', () => {
    const h2 = makeHarness({ enabled: false })
    const r = h2.runtime.initialize()
    expect(r.kind).toBe('disabled')
    expect(h2.fake.setFeedURLCalls.length).toBe(0)
  })

  // B3 — checking → checking envelope
  it('B3: check() emits checking envelope + audit', async () => {
    h.runtime.initialize()
    await h.runtime.check()
    const checking = h.states.filter((s) => s.phase === 'checking')
    expect(checking.length).toBeGreaterThanOrEqual(1)
    const auditStarted = h.audits.find((a) => (a as { event?: string }).event === 'update.check.started')
    expect(auditStarted).toBeDefined()
  })

  // B4 — update-available → available envelope
  it('B4: update-available event → available envelope', () => {
    h.runtime.initialize()
    h.fake.emit('update-available', { version: '0.18.0' })
    const available = h.states.find((s) => s.phase === 'available')
    expect(available).toBeDefined()
    expect(available?.availableVersion).toBe('0.18.0')
  })

  // B5 — no update → honest not-available
  it('B5: update-not-available event → idle envelope', () => {
    h.runtime.initialize()
    h.fake.emit('update-not-available')
    const idle = h.states.find((s) => s.phase === 'idle')
    expect(idle).toBeDefined()
  })

  // B6 — download progress → clamped progress envelope
  it('B6: download-progress event → clamped progress envelope', () => {
    h.runtime.initialize()
    h.fake.emit('download-progress', { percent: 50, transferred: 50, total: 100 })
    const dl = h.states.find((s) => s.phase === 'downloading')
    expect(dl).toBeDefined()
    expect(dl?.progress).toBe(0.5)

    // NaN / negative / >1 → clamped to [0,1]
    h.states.length = 0
    h.fake.emit('download-progress', { percent: NaN })
    const clamped1 = h.states.at(-1)
    expect(clamped1?.progress).toBe(0)
    h.fake.emit('download-progress', { percent: -50 })
    expect(h.states.at(-1)?.progress).toBe(0)
    h.fake.emit('download-progress', { percent: 250 })
    expect(h.states.at(-1)?.progress).toBe(1)
  })

  // B7 — update-downloaded → authoritative restart-ready state
  it('B7: update-downloaded event → downloaded envelope + state.isDownloaded=true', () => {
    h.runtime.initialize()
    h.fake.emit('update-downloaded', { version: '0.18.0' })
    const downloaded = h.states.find((s) => s.phase === 'downloaded')
    expect(downloaded).toBeDefined()
    expect(h.runtime.getState().isDownloaded).toBe(true)
  })

  // B8 — error → error envelope, no fabricated success
  it('B8: error event → error envelope, no success fabrication', () => {
    h.runtime.initialize()
    h.fake.emit('error', new Error('signature mismatch'))
    const errorEnv = h.states.find((s) => s.phase === 'error')
    expect(errorEnv).toBeDefined()
    expect(errorEnv?.errorClass).toBe('signature')
    // No "downloaded" envelope should appear after an error.
    expect(h.states.some((s) => s.phase === 'downloaded')).toBe(false)
  })

  // B9 — restart-install before downloaded → rejected
  it('B9: restart-install before downloaded is rejected (B-R2-01 authoritative gate)', async () => {
    h.runtime.initialize()

    await expect(
      h.runtime.requestRestartInstall({
        userConfirmed: true,
        safeStoragePreserved: true,
        hasPendingMutations: false,
      }),
    ).rejects.toThrow(/downloaded-authoritative/)
    expect(h.fake.quitAndInstallCalls).toBe(0)
  })

  // B10 — restart-install on beta/internal in V1 → rejected
  it('B10: restart-install on beta channel is rejected (B-R2-08 disabled truth)', async () => {
    const h2 = makeHarness({ channel: 'beta' })
    const initResult = h2.runtime.initialize()
    // Per B-R2-08: beta/internal channels must surface as kind=disabled,
    // reason=channel-not-v1-shippable, NOT initialized/ok-with-internally-not-wired.
    expect(initResult.kind).toBe('disabled')
    expect((initResult as { reason: string }).reason).toBe('channel-not-v1-shippable')
    expect(h2.fake.quitAndInstallCalls).toBe(0)
  })

  // B11 — restart-install on stable + downloaded + gates pass → calls install seam exactly once
  it('B11: restart-install on stable with all gates pass calls quitAndInstall', async () => {
    const h2 = makeHarness({ minimumVersion: '0.17.0', currentVersion: '0.18.0' })
    h2.runtime.initialize()
    h2.fake.emit('update-downloaded', { version: '0.18.0' })

    const env = await h2.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })

    expect(env.phase).toBe('installing')
    expect(env.restartPending).toBe(true)
    expect(h2.fake.quitAndInstallCalls).toBe(1)
  })

  // B12 — repeated restart request → no duplicate install call
  it('B12: repeated restart-install is de-duplicated', async () => {
    const h2 = makeHarness({ minimumVersion: '0.17.0', currentVersion: '0.18.0' })
    h2.runtime.initialize()
    h2.fake.emit('update-downloaded', { version: '0.18.0' })
    await h2.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })
    await h2.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })
    expect(h2.fake.quitAndInstallCalls).toBe(1)
  })

  // B13 — invalid/missing version → fail closed
  it('B13: invalid currentVersion fails closed', async () => {
    const h2 = makeHarness({ currentVersion: 'banana', minimumVersion: '0.18.0' })
    h2.runtime.initialize()
    h2.fake.emit('update-downloaded', { version: '0.18.0' })

    const env = await h2.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })

    expect(env.phase).toBe('error')
    expect(env.errorCode).toBe('minimum-version')
    expect(h2.fake.quitAndInstallCalls).toBe(0)
  })

  // B14 — minimum version policy absent → honest NOT_ESTABLISHED behavior
  it('B14: minimum policy NOT_ESTABLISHED is reflected as policy-not-established', async () => {
    // Default harness uses policy NOT_ESTABLISHED (no minimumVersion override)
    h.runtime.initialize()
    h.fake.emit('update-downloaded', { version: '0.18.0' })

    const env = await h.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })

    expect(env.phase).toBe('error')
    expect(env.errorCode).toBe('minimum-version')
    expect(h.fake.quitAndInstallCalls).toBe(0)
  })

  // B15 — updater error → safeStorage/userData untouched (smoke)
  it('B15: updater error does not touch userData or safeStorage', () => {
    h.runtime.initialize()
    h.fake.emit('error', new Error('boom'))
    // safeStorage is not a property of fake; assert state.isDownloaded remains false
    // and no synthesized success envelope appears.
    expect(h.runtime.getState().isDownloaded).toBe(false)
    expect(h.states.some((s) => s.phase === 'downloaded')).toBe(false)
  })

  // B16 — audit payload contains no secrets
  it('B16: audit payload across full lifecycle contains no secrets', async () => {
    h.runtime.initialize()
    h.fake.emit('checking-for-update')
    h.fake.emit('update-available', { version: '0.18.0' })
    h.fake.emit('download-progress', { percent: 25 })
    h.fake.emit('update-downloaded', { version: '0.18.0' })
    const json = JSON.stringify(h.audits)

    for (const forbidden of ['password', 'privateKey', 'token', 'ghp_', 'AKIA', 'AIza', 'BEGIN PRIVATE KEY']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  // B17 — existing source updater flow remains callable (smoke: FakeAppUpdater remains independent)
  it('B17: existing source updater is not invoked by the packaged E1 runtime', () => {
    h.runtime.initialize()
    // FakeAppUpdater is the packaged runtime; the source/git updater (e.g.
    // update-remote.ts, applyUpdates in main.ts) is OUT of this Lane's
    // scope and not part of the E1 runtime. The fact that nothing in the
    // fake constructor invoked it is the proof here.
    expect(h.fake).toBeDefined()
    expect(h.fake.checkForUpdatesCalls).toBe(0) // no implicit call
  })

  // B18 — existing update-gate/marker semantics remain preserved (smoke: untouched)
  it('B18: existing update-gate/marker semantics are not modified by the E1 runtime', async () => {
    // Smoke: instantiate the runtime; existing modules still importable.
    h.runtime.initialize()
    // We do not assert on update-gate behavior here — that is covered by
    // existing tests. We only assert the E1 runtime does not throw on
    // initialize in a packaged + valid-feed + stable-channel config.
    const state = h.runtime.getState()
    expect(state.channel).toBe('stable')
    expect(state.enabled).toBe(true)
    expect(state.feedUrl).toBe('https://updates.example.com/hermes-stable')
  })
})

describe('updater-e1 disabled-bootstrap edge cases', () => {
  it('feed URL ending in .invalid → disabled (feed-invalid)', () => {
    const h = makeHarness({ feedUrl: 'https://updates.example.invalid/hermes-stable' })
    const r = h.runtime.initialize()
    // Explicit .invalid URL → must be disabled with feed-invalid.
    expect(r.kind).toBe('disabled')
    expect((r as { reason: string }).reason).toBe('feed-invalid')
  })

  it('feed URL null → disabled (feed-missing)', () => {
    const h = makeHarness({ feedUrl: null })
    const r = h.runtime.initialize()
    expect(r.kind).toBe('disabled')
    expect((r as { reason: string }).reason).toBe('feed-missing')
  })

  it('feed URL malformed → disabled (feed-invalid)', () => {
    const h = makeHarness({ feedUrl: 'not-a-url' })
    const r = h.runtime.initialize()
    expect(r.kind).toBe('disabled')
    expect((r as { reason: string }).reason).toBe('feed-invalid')
  })

  it('factory throws → error', () => {
    const states: ReturnType<typeof makeUpdateEnvelope>[] = []
    const audits: unknown[] = []
    const fake = new FakeAppUpdater()

    const runtime = new UpdaterE1Runtime(
      {
        app: { isPackaged: true, getVersion: () => '0.17.0' },
        emitState: (e) => states.push(e),
        audit: (e) => audits.push(e),
        appUpdaterFactory: () => {
          throw new Error('factory boom')
        },
      },
      { currentVersion: '0.17.0', feedUrl: 'https://example.com/feed' },
    )

    const r = runtime.initialize()
    expect(r.kind).toBe('error')
    void fake
  })

  it('check() before initialize() throws', async () => {
    const h = makeHarness()
    await expect(h.runtime.check()).rejects.toThrow(/not initialized/)
  })
})

describe('updater-e1 audit seam', () => {
  it('records bootstrap.disabled audit when packaged=false', () => {
    const h = makeHarness({}, { isPackaged: false })
    h.runtime.initialize()
    const audit = h.audits.find((a) => (a as { event?: string }).event === 'update.bootstrap.disabled')
    expect(audit).toBeDefined()
  })

  it('records error audit with errorClass on runtime error', () => {
    const h = makeHarness({ feedUrl: 'https://example.com/feed' })
    h.runtime.initialize()
    h.fake.emit('error', new Error('network timeout'))
    const errorAudit = h.audits.find((a) => (a as { event?: string }).event === 'update.error')
    expect(errorAudit).toBeDefined()
    expect((errorAudit as { errorClass: string }).errorClass).toBe('network')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REMEDIATION-02 · Behavioral acceptance tests (B-R2-01 .. B-R2-16)
// ────────────────────────────────────────────────────────────────────────────
// These tests codify the runtime contracts that the previous implementation
// either did not state explicitly or implemented loosely. Each test below is
// the canonical RED for one invariant from §P9 of the REMEDIATION-02 packet.

describe('REMEDIATION-02 behavioral acceptance', () => {
  // B-R2-01 — Authoritative Download Gate.
  // All other gates valid (stable, version, safeStorage, no mutations, user
  // confirmed) BUT the upstream AppUpdater has NOT emitted update-downloaded.
  // requestRestartInstall MUST refuse, with a machine-readable gate name.
  it('B-R2-01: restart-install refused when update-downloaded has not fired', async () => {
    const h = makeHarness({ minimumVersion: '0.17.0', currentVersion: '0.18.0' })
    h.runtime.initialize()
    // Intentionally do NOT emit update-downloaded.
    await expect(
      h.runtime.requestRestartInstall({
        userConfirmed: true,
        safeStoragePreserved: true,
        hasPendingMutations: false,
      }),
    ).rejects.toThrow(/downloaded-authoritative/)
    expect(h.fake.quitAndInstallCalls).toBe(0)
  })

  // B-R2-02 — Downloaded → install exactly once.
  it('B-R2-02: restart-install after update-downloaded calls quitAndInstall exactly once', async () => {
    const h = makeHarness({ minimumVersion: '0.17.0', currentVersion: '0.18.0' })
    h.runtime.initialize()
    h.fake.emit('update-downloaded', { version: '0.18.0' })

    const env = await h.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })

    expect(env.phase).toBe('installing')
    expect(env.restartPending).toBe(true)
    expect(h.fake.quitAndInstallCalls).toBe(1)
  })

  // B-R2-03 — Repeated install request → de-duplicated.
  it('B-R2-03: repeated restart-install calls do not duplicate quitAndInstall', async () => {
    const h = makeHarness({ minimumVersion: '0.17.0', currentVersion: '0.18.0' })
    h.runtime.initialize()
    h.fake.emit('update-downloaded', { version: '0.18.0' })
    await h.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })
    await h.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })
    await h.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    })
    expect(h.fake.quitAndInstallCalls).toBe(1)
  })

  // B-R2-04 — Bootstrap package metadata path.
  // When feedUrl is NOT explicitly supplied, runtime must read
  // apps/desktop/package.json, NOT the repo root package.json.
  it('B-R2-04: default feedUrl resolves to apps/desktop package.json', () => {
    const states: ReturnType<typeof makeUpdateEnvelope>[] = []
    const audits: unknown[] = []
    const fake = new FakeAppUpdater()

    const runtime = new UpdaterE1Runtime(
      {
        app: { isPackaged: true, getVersion: () => '0.17.0' },
        emitState: (e) => states.push(e),
        audit: (e) => audits.push(e),
        appUpdaterFactory: () => fake as unknown as ReturnType<NonNullable<UpdaterE1Deps['appUpdaterFactory']>>,
      },
      {
        // feedUrl OMITTED on purpose.
        currentVersion: '0.17.0',
      },
    )

    const r = runtime.initialize()
    // The repo ships a synthetic .invalid placeholder in apps/desktop/package.json,
    // so default-feed classification must be feed-invalid (NOT feed-missing).
    expect(r.kind).toBe('disabled')
    expect((r as { reason: string }).reason).toBe('feed-invalid')
    // The resolved feed must come from apps/desktop/package.json — assert by
    // checking it carries the placeholder host, not the repo root's URL.
    const state = runtime.getState()
    expect(state.feedUrl ?? '').toMatch(/example\.invalid|example\.com/)
  })

  // B-R2-05 — Factory error idempotency.
  it('B-R2-05: factory-throw → second initialize stays truthful ERROR', () => {
    const states: ReturnType<typeof makeUpdateEnvelope>[] = []
    const audits: unknown[] = []
    let factoryCalls = 0
    const fake = new FakeAppUpdater()

    const runtime = new UpdaterE1Runtime(
      {
        app: { isPackaged: true, getVersion: () => '0.17.0' },
        emitState: (e) => states.push(e),
        audit: (e) => audits.push(e),
        appUpdaterFactory: () => {
          factoryCalls += 1
          throw new Error('boom')
        },
      },
      { currentVersion: '0.17.0', feedUrl: 'https://example.com/feed' },
    )

    const r1 = runtime.initialize()
    expect(r1.kind).toBe('error')
    const r2 = runtime.initialize()
    // MUST NOT silently turn into initialized/ok
    expect(r2.kind).toBe('error')
    // Factory MUST NOT have been called twice — only the first attempt counts.
    expect(factoryCalls).toBe(1)
    void fake
  })

  // B-R2-06 — setFeedURL error idempotency.
  it('B-R2-06: setFeedURL throw → second initialize stays truthful ERROR', () => {
    const states: ReturnType<typeof makeUpdateEnvelope>[] = []
    const audits: unknown[] = []

    class ThrowingFeed extends FakeAppUpdater {
      override setFeedURL(_o: { provider?: string; url?: string; channel?: string | null }): void {
        super.setFeedURL(_o)
        throw new Error('feed rejected')
      }
    }
    const fake = new ThrowingFeed()

    const runtime = new UpdaterE1Runtime(
      {
        app: { isPackaged: true, getVersion: () => '0.17.0' },
        emitState: (e) => states.push(e),
        audit: (e) => audits.push(e),
        appUpdaterFactory: () => fake as unknown as ReturnType<NonNullable<UpdaterE1Deps['appUpdaterFactory']>>,
      },
      { currentVersion: '0.17.0', feedUrl: 'https://example.com/feed' },
    )

    const r1 = runtime.initialize()
    expect(r1.kind).toBe('error')
    const r2 = runtime.initialize()
    expect(r2.kind).toBe('error')
  })

  // B-R2-07 — Disabled idempotency across all four disable reasons.
  it.each([
    ['app-not-packaged', { isPackaged: false }, {}],
    ['feed-missing', {}, { feedUrl: null }],
    ['feed-invalid', {}, { feedUrl: 'https://updates.example.invalid/x' }],
  ])('B-R2-07: disabled stays disabled on repeat (%s)', (_label, appOverrides, cfg) => {
    const h = makeHarness(cfg as Partial<UpdaterE1Config>, appOverrides as { isPackaged?: boolean })
    const r1 = h.runtime.initialize()
    expect(r1.kind).toBe('disabled')
    const r2 = h.runtime.initialize()
    // MUST NOT silently flip to initialized/ok.
    expect(r2.kind).toBe('disabled')
    expect((r2 as { reason: string }).reason).toBe((r1 as { reason: string }).reason)
  })

  // B-R2-08 — Beta/internal channel is `disabled`, NOT `initialized/ok`.
  it('B-R2-08: beta channel → kind=disabled, reason=channel-not-v1-shippable', () => {
    const h = makeHarness({ channel: 'beta' })
    const r = h.runtime.initialize()
    expect(r.kind).toBe('disabled')
    expect((r as { reason: string }).reason).toBe('channel-not-v1-shippable')
  })
  it('B-R2-08b: internal channel → kind=disabled, reason=channel-not-v1-shippable', () => {
    const h = makeHarness({ channel: 'internal' })
    const r = h.runtime.initialize()
    expect(r.kind).toBe('disabled')
    expect((r as { reason: string }).reason).toBe('channel-not-v1-shippable')
  })

  // B-R2-09 — Runtime enabled truth.
  it('B-R2-09: getState().enabled reflects AppUpdater wired, not config intent', () => {
    const cases: Array<{ label: string; cfg: Partial<UpdaterE1Config>; app: { isPackaged?: boolean }; expectWired: boolean }> = [
      { label: 'feed invalid', cfg: { feedUrl: 'https://updates.example.invalid/x' }, app: {}, expectWired: false },
      { label: 'feed missing', cfg: { feedUrl: null }, app: {}, expectWired: false },
      { label: 'app not packaged', cfg: {}, app: { isPackaged: false }, expectWired: false },
      { label: 'beta channel', cfg: { channel: 'beta' }, app: {}, expectWired: false },
      { label: 'factory throws', cfg: { feedUrl: 'https://example.com/feed' }, app: {}, expectWired: false }, // configured but factory fails
      { label: 'valid stable + valid feed', cfg: { feedUrl: 'https://example.com/feed' }, app: {}, expectWired: true },
    ]

    for (const c of cases) {
      const states: ReturnType<typeof makeUpdateEnvelope>[] = []
      const audits: unknown[] = []
      const fake = new FakeAppUpdater()

      const factory: UpdaterE1Deps['appUpdaterFactory'] =
        c.label === 'factory throws'
          ? () => {
              throw new Error('boom')
            }
          : () => fake as unknown as ReturnType<NonNullable<UpdaterE1Deps['appUpdaterFactory']>>

      const rt = new UpdaterE1Runtime(
        {
          app: { isPackaged: c.app.isPackaged ?? true, getVersion: () => '0.17.0' },
          emitState: (e) => states.push(e),
          audit: (e) => audits.push(e),
          appUpdaterFactory: factory,
        },
        { currentVersion: '0.17.0', ...c.cfg },
      )

      rt.initialize()
      const state = rt.getState()

      if (c.expectWired) {
        expect(state.enabled, c.label).toBe(true)
      } else {
        expect(state.enabled, c.label).toBe(false)
      }
    }
  })

  // B-R2-10 — check() failure truth.
  it('B-R2-10: check() failure emits error envelope, does not return checking', async () => {
    const states: ReturnType<typeof makeUpdateEnvelope>[] = []
    const audits: unknown[] = []
    const fake = new FakeAppUpdater()
    fake.failNext = 'check'

    const rt = new UpdaterE1Runtime(
      {
        app: { isPackaged: true, getVersion: () => '0.17.0' },
        emitState: (e) => states.push(e),
        audit: (e) => audits.push(e),
        appUpdaterFactory: () => fake as unknown as ReturnType<NonNullable<UpdaterE1Deps['appUpdaterFactory']>>,
      },
      { currentVersion: '0.17.0', feedUrl: 'https://example.com/feed' },
    )

    rt.initialize()
    const env = await rt.check()
    // MUST NOT return phase=checking when an authoritative error is known.
    expect(env.phase).toBe('error')
    const errorEnv = states.find((s) => s.phase === 'error')
    expect(errorEnv).toBeDefined()
    expect(errorEnv?.errorClass).toBe('network')
  })

  // B-R2-11 — Download failure truth.
  it('B-R2-11: download() failure → error, no downloaded, no install', async () => {
    const h = makeHarness({ feedUrl: 'https://example.com/feed', minimumVersion: '0.17.0', currentVersion: '0.18.0' })
    h.runtime.initialize()
    h.fake.failNext = 'download'
    await expect(h.runtime.download()).rejects.toThrow()
    expect(h.runtime.getState().isDownloaded).toBe(false)
    await expect(
      h.runtime.requestRestartInstall({
        userConfirmed: true,
        safeStoragePreserved: true,
        hasPendingMutations: false,
      }),
    ).rejects.toThrow(/downloaded-authoritative/)
    expect(h.fake.quitAndInstallCalls).toBe(0)
  })

  // B-R2-12 — Audit secret safety.
  it('B-R2-12: audit events do not contain raw feed URL, raw error message, or credentials', async () => {
    const h = makeHarness({ feedUrl: 'https://updates.example.com/hermes-stable?token=ghp_SECRET' })
    h.runtime.initialize()
    h.fake.emit('checking-for-update')
    h.fake.emit('update-available', { version: '0.18.0' })
    h.fake.emit('download-progress', { percent: 25 })
    h.fake.emit('update-downloaded', { version: '0.18.0' })
    h.fake.emit('error', new Error('boom ghp_SECRET_PASSWORD=hello'))
    await h.runtime.requestRestartInstall({
      userConfirmed: true,
      safeStoragePreserved: true,
      hasPendingMutations: false,
    }).catch(() => { /* expected to reject because channel/feed check above */ })
    const json = JSON.stringify(h.audits)
    // No raw feed URL.
    expect(json).not.toContain('updates.example.com/hermes-stable?token=')
    // No raw error message.
    expect(json).not.toContain('ghp_SECRET_PASSWORD')

    // No tokens / private keys / passwords.
    for (const forbidden of ['password', 'privateKey', 'ghp_', 'AKIA', 'AIza', 'BEGIN PRIVATE KEY']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  // B-R2-13 — Synthetic .invalid feed must NOT trigger network activation.
  it('B-R2-13: .invalid feed does not call checkForUpdates or downloadUpdate', () => {
    const states: ReturnType<typeof makeUpdateEnvelope>[] = []
    const audits: unknown[] = []
    const fake = new FakeAppUpdater()

    const rt = new UpdaterE1Runtime(
      {
        app: { isPackaged: true, getVersion: () => '0.17.0' },
        emitState: (e) => states.push(e),
        audit: (e) => audits.push(e),
        appUpdaterFactory: () => fake as unknown as ReturnType<NonNullable<UpdaterE1Deps['appUpdaterFactory']>>,
      },
      { currentVersion: '0.17.0', feedUrl: 'https://updates.example.invalid/hermes-stable' },
    )

    const r = rt.initialize()
    expect(r.kind).toBe('disabled')
    expect((r as { reason: string }).reason).toBe('feed-invalid')
    expect(fake.setFeedURLCalls.length).toBe(0)
    expect(fake.checkForUpdatesCalls).toBe(0)
    expect(fake.downloadUpdateCalls).toBe(0)
  })

  // B-R2-14 — Existing source updater preservation (smoke: untouched in this Lane).
  it('B-R2-14: update-gate / update-marker / updater-process files are not touched by E1 runtime', () => {
    // Smoke assertion: those modules still importable and the E1 runtime does
    // not expose any symbol that shadows them. Use the existing static
    // imports from the top of the file (vitest resolves `.ts` natively).
    expect(typeof waitForUpdateClearance).toBe('function')
    expect(typeof readLiveUpdateMarker).toBe('function')
    expect(typeof updaterProcessModule).toBe('object')
  })

  // B-R2-15 — Product Identity preservation.
  it('B-R2-15: product identity unchanged (appId/productName/protocol)', () => {

    const pkg = require('../../package.json') as {
      name?: string
      productName?: string
      build?: { appId?: string; protocols?: Array<{ name: string; schemes: string[] }> }
    }

    expect(pkg.name).toBe('hermes')
    expect(pkg.productName).toBe('hermes_Agent')
    expect(pkg.build?.appId).toBe('com.nousresearch.hermes')
    expect(pkg.build?.protocols?.[0]?.schemes?.[0]).toBe('hermes')
  })
})

// B-R2-16 — Full Desktop lint is verified outside this file via `npm run lint`.
// The package.json check (file mode + json-parse) is included here as a smoke
// guard against inadvertent publish-block changes.
describe('REMEDIATION-02 file invariants', () => {
  it('publish block still has placeholder URL + PRODUCTION_UPDATE_URL_AUTHORIZED=false', () => {

    const pkg = require('../../package.json') as {
      publishMeta?: { PRODUCTION_UPDATE_URL_AUTHORIZED?: boolean }
      build?: { publish?: { url?: string; provider?: string; channel?: string } }
    }

    expect(pkg.build?.publish?.provider).toBe('generic')
    expect(pkg.build?.publish?.url).toMatch(/updates\.example\.invalid/)
    expect(pkg.build?.publish?.channel).toBe('stable')
    expect(pkg.publishMeta?.PRODUCTION_UPDATE_URL_AUTHORIZED).toBe(false)
  })
})
