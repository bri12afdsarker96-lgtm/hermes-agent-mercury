'use strict'

/**
 * update-state-channel.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-02 · Line B REMEDIATION-01
 *
 * Pure contract for progress / error state messages flowing from the main
 * process to the renderer during an update. The wire format is the canonical
 * IPC channel name + a frozen-state envelope.
 *
 * Per REMEDIATION-01 §10/§11/§13/§15/§16:
 *   - Wire real updater events/state into the E1 state contract.
 *   - Strict validated semantic-version parser (NOT permissive semver-loose).
 *   - NO hard-coded minimum-supported-version (was 0.18.0 in pre-remediation
 *     branch — REMEDIATION-01 §15 explicitly REJECTED that as unauthorized
 *     product policy).
 *   - Channel policy is enforced upstream in update-channel.ts; this module
 *     consumes the resolved channel string and the V1-shippable predicate.
 *
 * This module is PURE:
 *   - No Electron import, no IPC, no node APIs beyond `Object.freeze`.
 *   - No real signing secret reference.
 *   - No side effects beyond frozen module-scope constants.
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

/**
 * REMEDIATION-01 §15: minimum-supported-version is NOT a hard-coded product
 * decision. It is configuration / update metadata / release-policy input.
 *
 * Until TOTAL-CONTROL authorizes a specific value, the policy is
 * `NOT_ESTABLISHED` and any caller passing `undefined` (or the explicit
 * `NOT_ESTABLISHED_MINIMUM_VERSION` sentinel below) receives an honest
 * "policy missing" error instead of an invented default.
 */
export const NOT_ESTABLISHED_MINIMUM_VERSION = '__NOT_ESTABLISHED__'

export type MinimumVersionPolicy =
  | { kind: 'configured'; version: string }
  | { kind: 'not-established' }

/** Canonical IPC channel name for the update state stream. */
export const UPDATE_STATE_CHANNEL = 'hermes:update-state'

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
 * REMEDIATION-01 §16: strict validated semver parser. Replaces the previous
 * `compareSemverLoose` helper which silently turned malformed components
 * into numeric zero (e.g. "1.2.banana" → "1.2.0").
 *
 * Strict rules:
 *   - Accepts core semver X.Y.Z (each component a non-negative integer).
 *   - Accepts missing components: "1.2" → "1.2.0", "1" → "1.0.0".
 *   - Rejects empty strings, non-numeric components, leading zeros, and any
 *     pre-release / build-metadata suffix (not required by V1 floor check).
 *   - Pre-release and build-metadata variants are E2 concerns; this module
 *     does NOT decide them.
 */
const STRICT_SEMVER_RE = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/

export type StrictSemverResult =
  | { ok: true; components: readonly [number, number, number] }
  | { ok: false; reason: 'empty' | 'malformed' }

export function parseStrictSemver(value: unknown): StrictSemverResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'empty' }
  }

  if (!STRICT_SEMVER_RE.test(value)) {
    return { ok: false, reason: 'malformed' }
  }

  const parts = value.split('.').map((p) => Number.parseInt(p, 10))
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0

  return { ok: true, components: [major, minor, patch] as const }
}

export type CompareSemverResult = -1 | 0 | 1

/**
 * Compare two version strings strictly. Returns:
 *   -1 when `a < b`
 *    0 when `a === b`
 *    1 when `a > b`
 *
 * Either input malformed → throws `RangeError` (deliberate, so a malformed
 * version cannot silently pass an install gate).
 */
export function compareStrictSemver(a: unknown, b: unknown): CompareSemverResult {
  const pa = parseStrictSemver(a)
  const pb = parseStrictSemver(b)

  if (pa.ok === false) {
    throw new RangeError(`compareStrictSemver: invalid version a=${JSON.stringify(a)} (${pa.reason})`)
  }

  if (pb.ok === false) {
    throw new RangeError(`compareStrictSemver: invalid version b=${JSON.stringify(b)} (${pb.reason})`)
  }

  for (let i = 0; i < 3; i += 1) {
    const na = pa.components[i]
    const nb = pb.components[i]

    if (na < nb) {return -1}

    if (na > nb) {return 1}
  }

  return 0
}

/**
 * Pure helper: assert the installed version meets the policy-provided
 * minimum. Used by the host before pushing 'downloaded' or 'installing'
 * envelopes, and by evaluateRestartInstall before allowing install.
 *
 * REMEDIATION-01 §15: minimum is required. `undefined` is rejected with
 * `policy-not-established`; the sentinel `NOT_ESTABLISHED_MINIMUM_VERSION`
 * is the explicit marker an honest host emits when the release policy has
 * not yet been set.
 */
export type MinimumVersionGateResult =
  | { ok: true }
  | {
      ok: false
      reason: UpdateErrorClass | 'policy-not-established' | 'malformed-version'
      message: string
    }

export function assertMinimumVersionSupported(
  currentVersion: unknown,
  minimum: unknown,
): MinimumVersionGateResult {
  const currentParsed = parseStrictSemver(currentVersion)

  if (currentParsed.ok === false) {
    return {
      ok: false,
      reason: 'malformed-version',
      message: `currentVersion not strict semver (got ${JSON.stringify(currentVersion)}, ${currentParsed.reason})`,
    }
  }

  if (
    minimum === undefined ||
    minimum === null ||
    minimum === '' ||
    minimum === NOT_ESTABLISHED_MINIMUM_VERSION
  ) {
    return {
      ok: false,
      reason: 'policy-not-established',
      message: 'minimum-supported-version policy not established; refusing to pass install gate',
    }
  }

  const minimumParsed = parseStrictSemver(minimum)

  if (minimumParsed.ok === false) {
    return {
      ok: false,
      reason: 'malformed-version',
      message: `minimumVersion not strict semver (got ${JSON.stringify(minimum)}, ${minimumParsed.reason})`,
    }
  }

  try {
    if (compareStrictSemver(currentVersion, minimum) < 0) {
      return {
        ok: false,
        reason: 'minimum-version',
        message: `currentVersion ${String(currentVersion)} < required ${String(minimum)}`,
      }
    }
  } catch {
    return {
      ok: false,
      reason: 'malformed-version',
      message: 'strict semver compare threw',
    }
  }

  return { ok: true }
}
