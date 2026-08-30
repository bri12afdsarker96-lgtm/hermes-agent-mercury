'use strict'

/**
 * update-policy.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-02 · Line B REMEDIATION-01
 *
 * Repo-owned updater policy module (REMEDIATION-01 §15 + §18). This file
 * holds values that were previously invented as hard-coded constants in
 * `update-state-channel.ts` (`V1_MINIMUM_SUPPORTED_VERSION = '0.18.0'`)
 * and in the electron-builder `build.update` block (rejected by pinned
 * electron-builder 26.15.3 schema — REMEDIATION-01 §18).
 *
 * Policy status as of REMEDIATION-01 ship:
 *   MINIMUM_SUPPORTED_VERSION_POLICY = NOT_ESTABLISHED
 *
 *   This is HONEST: the previous commit invented 0.18.0 as a V1 floor while
 *   Desktop product version is 0.17.0 — REMEDIATION-01 §15 rejected that
 *   as unauthorized product policy. Until TOTAL-CONTROL authorizes a
 *   specific floor, the runtime gates (restart-install + minimum-version
 *   assertion) fail-closed and surface `policy-not-established` instead of
 *   fabricating success.
 *
 *   When TOTAL-CONTROL authorizes a value, replace `MINIMUM_VERSION` here
 *   and bump `MINIMUM_SUPPORTED_VERSION_POLICY.kind` to `'configured'`.
 *   No other module needs to change — both gates consume this policy
 *   via dependency injection from `updater-e1.ts`.
 *
 * Channel list is the canonical allow-list (REMEDIATION-01 §14). V1
 * ships ONLY `stable`.
 */

import {
  ALLOWED_UPDATE_CHANNELS,
  DEFAULT_UPDATE_CHANNEL,
  isV1ShippableChannel,
  type UpdateChannelName,
} from './update-channel'
import {
  type MinimumVersionPolicy,
  NOT_ESTABLISHED_MINIMUM_VERSION,
} from './update-state-channel'

/** Repo-owned minimum-supported-version policy. */
export const MINIMUM_VERSION: string | typeof NOT_ESTABLISHED_MINIMUM_VERSION =
  NOT_ESTABLISHED_MINIMUM_VERSION

export const MINIMUM_SUPPORTED_VERSION_POLICY: MinimumVersionPolicy = {
  kind: 'not-established',
}

/** V1 shippable channel is exactly `stable`. */
export const V1_SHIPPABLE_CHANNEL: UpdateChannelName = DEFAULT_UPDATE_CHANNEL

/** Whether a channel name is allowed to ship in V1. Re-exports helper. */
export const isChannelAllowedForV1 = isV1ShippableChannel

/** Allow-list used by the runtime to validate channel overrides. */
export const REPO_OWNED_ALLOWED_CHANNELS: readonly UpdateChannelName[] =
  ALLOWED_UPDATE_CHANNELS

/**
 * Sanity-check the repo policy at module load. Throws on violation —
 * this is a developer-error guard, not a runtime gate.
 */
function assertPolicyConsistent(): void {
  if (
    MINIMUM_SUPPORTED_VERSION_POLICY.kind === 'configured' &&
    MINIMUM_VERSION === NOT_ESTABLISHED_MINIMUM_VERSION
  ) {
    throw new Error(
      '[update-policy] inconsistent state: policy kind="configured" but MINIMUM_VERSION is NOT_ESTABLISHED',
    )
  }

  if (
    MINIMUM_SUPPORTED_VERSION_POLICY.kind === 'not-established' &&
    MINIMUM_VERSION !== NOT_ESTABLISHED_MINIMUM_VERSION
  ) {
    throw new Error(
      '[update-policy] inconsistent state: policy kind="not-established" but MINIMUM_VERSION is set',
    )
  }

  if (!isV1ShippableChannel(V1_SHIPPABLE_CHANNEL)) {
    throw new Error(
      `[update-policy] V1_SHIPPABLE_CHANNEL=${V1_SHIPPABLE_CHANNEL} is not V1-shippable`,
    )
  }
}

assertPolicyConsistent()
