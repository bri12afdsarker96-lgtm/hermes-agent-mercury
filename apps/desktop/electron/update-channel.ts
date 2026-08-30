'use strict'

/**
 * update-channel.ts
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-01 · Lane B (E1 only).
 *
 * Stable update-channel plumbing. PURE module — no I/O, no Electron import,
 * no env mutation. Used by the main process to resolve the active channel
 * and by the renderer to display the resolved value.
 *
 * Per CONTINUATION-01 §P5.3 (E1 scope) + §P7.1 + global G9 (reuse-first):
 *   - EXTENDS the existing update domain (update-gate.ts / update-marker.ts
 *     / update-remote.ts) — does NOT replace it.
 *   - Reads no real signing secret.
 *   - Does NOT depend on electron-updater (the existing fork uses git-based
 *     update via update-remote.ts; this module only adds the policy contract
 *     layer).
 *
 * Channel names are open enums:
 *   - "stable"     : production signed releases only.
 *   - "beta"       : pre-release signed artifacts, opt-in.
 *   - "internal"   : internal dogfood builds (never user-distributable).
 *
 * Default is "stable" and is the only channel allowed to ship to V1.
 * Resolving "beta" / "internal" is allowed by this module but the host must
 * gate deployment against release policy (E2 contract — out of scope here).
 */

export type UpdateChannelName = 'stable' | 'beta' | 'internal'

export interface ResolvedUpdateChannel {
  name: UpdateChannelName
  /** Set when host must surface a non-default channel; UI can warn. */
  isDefault: boolean
  /** True when the env explicitly named this channel. */
  explicitOverride: boolean
  /** Source of resolution: env, default, or explicit override. */
  source: 'env' | 'default' | 'override'
}

/** Allowed channel names. Order matters only for `defaultOf()`. */
export const ALLOWED_UPDATE_CHANNELS: readonly UpdateChannelName[] = [
  'stable',
  'beta',
  'internal',
] as const

/** V1 default — every ship must use this unless explicitly overridden. */
export const DEFAULT_UPDATE_CHANNEL: UpdateChannelName = 'stable'

/**
 * Resolve the active channel from process.env. Pure; never throws.
 * Unknown / malformed values fall back to DEFAULT_UPDATE_CHANNEL and set
 * `isDefault = true`, `source = 'default'` so the host can warn.
 */
export function resolveUpdateChannel(env: NodeJS.ProcessEnv = process.env): ResolvedUpdateChannel {
  const raw = (env.HERMES_UPDATE_CHANNEL ?? '').toString().trim().toLowerCase()
  if (!raw) {
    return {
      name: DEFAULT_UPDATE_CHANNEL,
      isDefault: true,
      explicitOverride: false,
      source: 'default',
    }
  }

  const named = ALLOWED_UPDATE_CHANNELS.find((c) => c === raw)
  if (named === undefined) {
    // Unknown channel → silent fallback to default. The host MUST log this.
    return {
      name: DEFAULT_UPDATE_CHANNEL,
      isDefault: true,
      explicitOverride: true,
      source: 'env',
    }
  }

  return {
    name: named,
    isDefault: named === DEFAULT_UPDATE_CHANNEL,
    explicitOverride: true,
    source: 'env',
  }
}

/**
 * Validate that a channel name is one of the allowed enums. Pure; no I/O.
 * Used by deployment scripts / E2 harness to assert policy before publish.
 */
export function isAllowedUpdateChannel(name: unknown): name is UpdateChannelName {
  return (
    typeof name === 'string' &&
    (ALLOWED_UPDATE_CHANNELS as readonly string[]).includes(name)
  )
}

/**
 * Pure policy helper: returns true if `name` is allowed to ship in V1.
 * V1 may ship ONLY `stable`. `beta` and `internal` are reserved.
 */
export function isV1ShippableChannel(name: UpdateChannelName): boolean {
  return name === 'stable'
}
