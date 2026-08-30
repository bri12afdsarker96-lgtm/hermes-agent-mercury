'use strict'

/**
 * update-channel.test.ts + update-state-channel.test.ts + update-restart-install.test.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-01 · Lane B (E1) tests.
 *
 * Per CONTINUATION-01 §P5.6 verification contract:
 *   - targeted Electron tests
 *   - updater state tests
 *   - package/build config validation
 *   - git diff --check
 *
 * These tests are PURE (no Electron runtime) and use only `node:test` + the
 * built-in assert. They run in `npx vitest run --project electron` /
 * `node --test` depending on the project's test runner; vitest is the
 * canonical runner for the desktop app per apps/desktop/vitest.config.ts.
 *
 * Imports are written to be compatible with both runners (vitest auto-
 * provides `describe/it/expect`; for `node:test` use the explicit import).
 */

import { describe, expect, it } from 'vitest'

import {
  ALLOWED_UPDATE_CHANNELS,
  DEFAULT_UPDATE_CHANNEL,
  isAllowedUpdateChannel,
  isV1ShippableChannel,
  resolveUpdateChannel,
} from './update-channel'
import {
  UPDATE_STATE_CHANNEL,
  V1_MINIMUM_SUPPORTED_VERSION,
  assertMinimumVersionSupported,
  compareSemverLoose,
  isValidUpdateErrorClass,
  isValidUpdatePhase,
  makeUpdateEnvelope,
} from './update-state-channel'
import {
  evaluateRestartInstall,
  recordRestartAuditEvent,
} from './update-restart-install'

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
    expect(r.explicitOverride).toBe(true) // host tried to override but it was unknown
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
    expect(isValidUpdateErrorClass('canceled')).toBe(false) // en-US spelling only
    expect(isValidUpdateErrorClass(undefined)).toBe(false)
  })

  it('makeUpdateEnvelope freezes its result and fills ts', () => {
    const env = makeUpdateEnvelope({ phase: 'checking', channel: 'stable' })
    expect(env.phase).toBe('checking')
    expect(env.channel).toBe('stable')
    expect(typeof env.ts).toBe('number')
    expect(Object.isFrozen(env)).toBe(true)
  })

  it('minimum-version gate accepts current >= minimum', () => {
    const ok = assertMinimumVersionSupported('1.2.3', '1.0.0')
    expect(ok.ok).toBe(true)
  })

  it('minimum-version gate rejects current < minimum', () => {
    const bad = assertMinimumVersionSupported('0.5.0', '1.0.0')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.reason).toBe('minimum-version')
    }
  })

  it('minimum-version gate handles short versions', () => {
    expect(compareSemverLoose('1.2', '1.2.0')).toBe(0)
    expect(compareSemverLoose('1.2.0', '1.2.1')).toBe(-1)
    expect(compareSemverLoose('2.0.0', '1.99.99')).toBe(1)
  })

  it('V1_MINIMUM_SUPPORTED_VERSION is at least 0.18.0', () => {
    const cmp = compareSemverLoose(V1_MINIMUM_SUPPORTED_VERSION, '0.18.0')
    expect(cmp >= 0).toBe(true)
  })
})

describe('update-restart-install', () => {
  const base = {
    channel: 'stable',
    currentVersion: '1.0.0',
    hasPendingMutations: false,
    safeStoragePreserved: true,
    userConfirmed: true,
  }

  it('approves when all gates pass', () => {
    const d = evaluateRestartInstall(base)
    expect(d.ok).toBe(true)
    if (d.ok) {
      expect(d.gates.length).toBe(5)
    }
  })

  it('rejects when channel missing', () => {
    const d = evaluateRestartInstall({ ...base, channel: '' })
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.failedGate).toBe('channel-resolved')
    }
  })

  it('rejects when currentVersion below minimum', () => {
    const d = evaluateRestartInstall({ ...base, currentVersion: '0.5.0' })
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.failedGate).toBe('minimum-version')
    }
  })

  it('rejects when pending mutations exist', () => {
    const d = evaluateRestartInstall({ ...base, hasPendingMutations: true })
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.failedGate).toBe('no-pending-mutations')
    }
  })

  it('rejects when safeStorage not preserved', () => {
    const d = evaluateRestartInstall({ ...base, safeStoragePreserved: false })
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.failedGate).toBe('safeStorage-preserved')
    }
  })

  it('rejects when user has not confirmed', () => {
    const d = evaluateRestartInstall({ ...base, userConfirmed: false })
    expect(d.ok).toBe(false)
    if (!d.ok) {
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
      // explicit no-secret guarantee
      const json = JSON.stringify(ev)
      expect(json).not.toContain('password')
      expect(json).not.toContain('privateKey')
      expect(json).not.toContain('token')
    }
  })
})
