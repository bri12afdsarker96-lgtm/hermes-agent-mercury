'use strict'

/**
 * update-state-channel.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-01 · Lane B (E1 only).
 *
 * Pure contract for progress / error state messages flowing from the main
 * process to the renderer during an update. The wire format is the
 * canonical IPC channel name + a frozen-state envelope.
 *
 * Per CONTINUATION-01 §P5.3 (E1 scope):
 *   - "progress/error state transport" — this module IS that contract.
 *   - "minimum-supported-version plumbing" — exposes it as part of the
 *     state envelope.
 *
 * This module is PURE:
 *   - No Electron import, no IPC, no node APIs beyond `Object.freeze`.
 *   - No real signing secret reference.
 *   - No side effects beyond frozen module-scope constants.
 *
 * The host (main process) is responsible for ACTUALLY pushing these states
 * to the renderer. The contract here is the consumer-side schema and the
 * dispatcher-side helper.
 */

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'restart-required'
  | 'installing'
  | 'error'

export type UpdateErrorClass =
  | 'network'
  | 'channel-mismatch'
  | 'minimum-version'
  | 'signature'
  | 'disk-space'
  | 'cancelled'
  | 'unknown'

/**
 * Frozen, JSON-serializable update state envelope. Forward-compatible:
 * any field added later must be optional.
 */
export interface UpdateStateEnvelope {
  phase: UpdatePhase
  /** 0..1 — when applicable. */
  progress?: number
  /** Bytes downloaded so far. */
  bytesDownloaded?: number
  /** Total bytes for the active download (if known). */
  bytesTotal?: number
  /** Stable human-readable channel resolved from `update-channel.ts`. */
  channel?: string
  /** Minimum-supported-version advertised by the active channel. */
  minimumSupportedVersion?: string
  /** Current installed version (semver). */
  currentVersion?: string
  /** Available version when phase=available / downloaded. */
  availableVersion?: string
  /** Error class when phase=error. */
  errorClass?: UpdateErrorClass
  /** Stable error code (no secrets, no PII). */
  errorCode?: string
  /** Whether a restart-install has been requested. */
  restartPending?: boolean
  /** Unix ms when this envelope was emitted. */
  ts?: number
}

/** Canonical IPC channel name for the update state stream. */
export const UPDATE_STATE_CHANNEL = 'hermes:update-state'

/** Minimal minimum-supported-version floor for V1. */
export const V1_MINIMUM_SUPPORTED_VERSION = '0.18.0'

/** Pure producer-side helper: build a frozen envelope. */
export function makeUpdateEnvelope(
  partial: Omit<UpdateStateEnvelope, 'ts'> & { ts?: number },
): UpdateStateEnvelope {
  return Object.freeze({
    ts: partial.ts ?? Date.now(),
    ...partial,
  })
}

/** Pure validation helper. */
export function isValidUpdatePhase(value: unknown): value is UpdatePhase {
  return (
    value === 'idle' ||
    value === 'checking' ||
    value === 'available' ||
    value === 'downloading' ||
    value === 'downloaded' ||
    value === 'restart-required' ||
    value === 'installing' ||
    value === 'error'
  )
}

export function isValidUpdateErrorClass(value: unknown): value is UpdateErrorClass {
  return (
    value === 'network' ||
    value === 'channel-mismatch' ||
    value === 'minimum-version' ||
    value === 'signature' ||
    value === 'disk-space' ||
    value === 'cancelled' ||
    value === 'unknown'
  )
}

/**
 * Pure helper: assert the installed version is at or above
 * ``V1_MINIMUM_SUPPORTED_VERSION``. Used by the host before pushing
 * 'downloaded' or 'installing' envelopes.
 */
export function assertMinimumVersionSupported(
  currentVersion: string,
  minimum: string = V1_MINIMUM_SUPPORTED_VERSION,
): { ok: true } | { ok: false; reason: UpdateErrorClass; message: string } {
  if (typeof currentVersion !== 'string' || !currentVersion) {
    return {
      ok: false,
      reason: 'minimum-version',
      message: `currentVersion missing or empty (got ${JSON.stringify(currentVersion)})`,
    }
  }
  const cmp = compareSemverLoose(currentVersion, minimum)
  if (cmp < 0) {
    return {
      ok: false,
      reason: 'minimum-version',
      message: `currentVersion ${currentVersion} < required ${minimum}`,
    }
  }
  return { ok: true }
}

/**
 * Loose semver compare: handles `1.2`, `1.2.3`, `1.2.3-pre`, `1.2.3+meta`.
 * Returns -1 / 0 / 1 like `Array.prototype.sort`.
 *
 * Loose because we do NOT need full semver semantics for the V1 floor check —
 * we only need to know "is current >= minimum". For production upgrade logic
 * (E2 contract) use a real semver library.
 */
export function compareSemverLoose(a: string, b: string): -1 | 0 | 1 {
  const parse = (s: string): number[] => {
    const core = s.split('-')[0].split('+')[0]
    return core.split('.').map((p) => {
      const n = Number.parseInt(p, 10)
      return Number.isFinite(n) ? n : 0
    })
  }
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}
