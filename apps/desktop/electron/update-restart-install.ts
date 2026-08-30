'use strict'

/**
 * update-restart-install.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-02 · Line B REMEDIATION-01
 *
 * Pure wiring contract for restart-install. The actual Electron quit /
 * install / relaunch is performed by the host (main process) via the
 * existing `applyUpdates()` and `updater-process.ts` seams plus the
 * official `electron-updater` AppUpdater (see updater-e1.ts) — this
 * module only computes:
 *   - whether restart-install is safe to request,
 *   - what minimum gates must pass before the request,
 *   - the serialized payload describing the restart to the host.
 *
 * Per REMEDIATION-01 §13/§14:
 *   - "restart-install" MUST NOT accept beta/internal merely because
 *     channel string != "". `isV1ShippableChannel` is enforced.
 *   - Restart gate sequence (all required):
 *       channel-resolved → v1-shippable-channel → minimum-version →
 *       no-pending-mutations → safeStorage-preserved → user-confirmed
 *   - minimum-supported-version is REQUIRED (no default to a hard-coded
 *     value). Host MUST supply it from policy / config / release metadata
 *     or pass `NOT_ESTABLISHED_MINIMUM_VERSION` to fail-closed.
 *
 * NO real signing secret. NO daemon lifecycle. NO actual quit / install.
 */

import { isV1ShippableChannel, type UpdateChannelName } from './update-channel'
import {
  assertMinimumVersionSupported,
  NOT_ESTABLISHED_MINIMUM_VERSION,
} from './update-state-channel'

export type RestartInstallGate =
  | 'channel-resolved'
  | 'v1-shippable-channel'
  | 'minimum-version'
  | 'no-pending-mutations'
  | 'safeStorage-preserved'
  | 'user-confirmed'

export type RestartInstallDecision =
  | { ok: true; gates: readonly RestartInstallGate[]; ts: number }
  | {
      ok: false
      failedGate: RestartInstallGate
      reason: string
      ts: number
    }

export interface RestartInstallInput {
  /** Resolved channel name from update-channel.ts. */
  channel: string
  /** Currently installed version (strict semver). */
  currentVersion: string
  /**
   * Minimum-supported-version from policy. REQUIRED. If left as
   * NOT_ESTABLISHED_MINIMUM_VERSION (or undefined) the gate fails closed
   * with reason `policy-not-established` (REMEDIATION-01 §15).
   */
  minimumVersion: string | typeof NOT_ESTABLISHED_MINIMUM_VERSION
  /** Whether pending local mutations (uncommitted drafts, etc.) exist. */
  hasPendingMutations: boolean
  /** Whether safeStorage / userData preservation has been verified. */
  safeStoragePreserved: boolean
  /** Whether the user has explicitly confirmed restart. */
  userConfirmed: boolean
}

/** Pure: evaluate all gates; never throws. */
export function evaluateRestartInstall(
  input: RestartInstallInput,
): RestartInstallDecision {
  const ts = Date.now()

  const failed: { gate: RestartInstallGate; reason: string } | null = (() => {
    if (!input.channel || typeof input.channel !== 'string') {
      return { gate: 'channel-resolved', reason: 'channel missing' }
    }

    // V1 channel restriction — REMEDIATION-01 §14. Must be enforced even
    // when channel is non-empty.
    if (!isV1ShippableChannel(input.channel as UpdateChannelName)) {
      return {
        gate: 'v1-shippable-channel',
        reason: `channel ${input.channel} is not V1-shippable (only "stable" is)`,
      }
    }

    const mv = assertMinimumVersionSupported(
      input.currentVersion,
      input.minimumVersion,
    )

    if (mv.ok === false) {
      return { gate: 'minimum-version', reason: mv.message }
    }

    if (input.hasPendingMutations) {
      return { gate: 'no-pending-mutations', reason: 'pending mutations present' }
    }

    if (!input.safeStoragePreserved) {
      return { gate: 'safeStorage-preserved', reason: 'safeStorage not verified' }
    }

    if (!input.userConfirmed) {
      return { gate: 'user-confirmed', reason: 'user confirmation missing' }
    }

    return null
  })()

  if (failed !== null) {
    return { ok: false, failedGate: failed.gate, reason: failed.reason, ts }
  }

  return {
    ok: true,
    gates: [
      'channel-resolved',
      'v1-shippable-channel',
      'minimum-version',
      'no-pending-mutations',
      'safeStorage-preserved',
      'user-confirmed',
    ],
    ts,
  }
}

/**
 * Pure: produce the audit/metrics hook payload for a successful restart-install
 * request. The host is responsible for actually emitting the metric; this
 * function only computes the payload.
 */
export interface RestartAuditEvent {
  event: 'update.restart-install.requested'
  channel: string
  currentVersion: string
  minimumVersion: string
  gates: readonly RestartInstallGate[]
  ts: number
}

export function recordRestartAuditEvent(
  input: RestartInstallInput,
  decision: Extract<RestartInstallDecision, { ok: true }>,
): RestartAuditEvent {
  return {
    event: 'update.restart-install.requested',
    channel: input.channel,
    currentVersion: input.currentVersion,
    minimumVersion:
      input.minimumVersion === NOT_ESTABLISHED_MINIMUM_VERSION
        ? 'NOT_ESTABLISHED'
        : input.minimumVersion,
    gates: decision.gates,
    ts: decision.ts,
  }
}
