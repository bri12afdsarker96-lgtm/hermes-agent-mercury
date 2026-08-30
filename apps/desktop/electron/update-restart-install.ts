'use strict'

/**
 * update-restart-install.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-01 · Lane B (E1 only).
 *
 * Pure wiring contract for restart-install. The actual Electron quit /
 * install / relaunch is performed by the host (main process) via the
 * existing `applyUpdates()` and `updater-process.ts` seams — this module
 * only computes:
 *   - whether restart-install is safe to request,
 *   - what minimum gates must pass before the request,
 *   - the serialized payload describing the restart to the host.
 *
 * Per CONTINUATION-01 §P5.3 (E1 scope):
 *   - "restart-install wiring" — this module IS that contract layer.
 *   - "minimum-supported-version plumbing" — reuses update-state-channel.
 *   - "audit/metrics hook seam" — `recordRestartAuditEvent` stub.
 *
 * NO real signing secret. NO daemon lifecycle. NO actual quit / install.
 */

import {
  V1_MINIMUM_SUPPORTED_VERSION,
  assertMinimumVersionSupported,
} from './update-state-channel'

export type RestartInstallGate =
  | 'channel-resolved'
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
  /** Currently installed version. */
  currentVersion: string
  /** Whether pending local mutations (uncommitted drafts, etc.) exist. */
  hasPendingMutations: boolean
  /** Whether safeStorage / userData preservation has been verified. */
  safeStoragePreserved: boolean
  /** Whether the user has explicitly confirmed restart. */
  userConfirmed: boolean
  /** Optional override for the minimum-supported-version floor. */
  minimumVersion?: string
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
    const mv = assertMinimumVersionSupported(
      input.currentVersion,
      input.minimumVersion ?? V1_MINIMUM_SUPPORTED_VERSION,
    )
    if (!mv.ok) {
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
 *
 * Audit / metrics is an E1 SEAM, not an E1 contract. Per CONTINUATION-01
 * §P5.3 we only ship the contract here; the actual emitter lands in E2.
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
    minimumVersion: input.minimumVersion ?? V1_MINIMUM_SUPPORTED_VERSION,
    gates: decision.gates,
    ts: decision.ts,
  }
}
