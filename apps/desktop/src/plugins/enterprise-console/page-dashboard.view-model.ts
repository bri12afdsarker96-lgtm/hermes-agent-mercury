/**
 * Dashboard page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure functions only. No transport, no query hooks, no useValue, no
 * session atoms — the controller has already resolved them and passes
 * the resolved values in. This file composes a presentation-safe
 * shape for the view to render.
 *
 * The view-model delegates permission / capability authority to
 * `./capabilities.ts` and `./view-model.ts::deriveCommonViewModel`.
 * It does NOT maintain a parallel permission engine.
 *
 * Per W1-B1-REMEDIATION-01 §P5 (BLOCKER-2 layer direction), this file
 * owns `workspaceCopy` (a pure presentation derivation over the
 * resolved whoami) rather than importing it from the controller.
 *
 * V0 foundation addenda (P1-VIS-V0):
 *  - `*State` four-state discriminators for health & metrics keep the
 *    view's loading / error / healthy / down presentation honest
 *    without collapsing into binary truth (per P5: ERROR ≠ DOWN,
 *    LOADING ≠ ZERO).
 *  - `alertsCount` is a pure derivation over the server-declared
 *    `metrics.alerts` raw list. No aggregation invented.
 *  - `authModeDisplay` collapses `null | string → string` once at the
 *    VM boundary so the view has a single string to render.
 *  - `identityState` distinguishes `missing` (no whoami, no auth
 *    surface) from `authenticated` (server-declared whoami).
 */

import { capabilityStatus } from './capabilities'
import { type ConsolePage, findPage } from './catalog'
import type { CapabilityStatus, Health, Metrics, Whoami } from './types'
import { deriveCommonViewModel } from './view-model'
import type { CommonViewModelArgs } from './view-model'

/**
 * Role-derived workspace copy. Pure function over `whoami` (which is
 * server-declared truth); the mapping itself is presentation-only and
 * does NOT introduce role authority beyond what the server already
 * declared.
 *
 * If a future role is added, the default branch handles it honestly.
 */
export interface WorkspaceCopy {
  purpose: string
  title: string
}

export function workspaceCopy(who: null | Whoami): WorkspaceCopy {
  switch (who?.role) {
    case 'operator':
      return {
        purpose:
          'Your authenticated operational workspace, current service health and capability truth.',
        title: 'Operator Home',
      }

    case 'supervisor':
      return {
        purpose:
          'Supervisory workspace for current service health, scoped operations and capability truth.',
        title: 'Supervisor Workspace',
      }

    case 'tenant_admin':

    case 'super_admin':
      return {
        purpose:
          'Tenant administration overview for service health, authenticated scope and capability truth.',
        title: 'Tenant Admin Overview',
      }

    default:
      return {
        purpose:
          'Server health, authenticated workspace identity and current capability truth.',
        title: 'Workspace',
      }
  }
}

/**
 * Four-state truth surface for the `/api/health` panel.
 *
 *  - `loading`  → server is answering; UI shows skeleton, NOT "down".
 *  - `error`    → server call rejected; UI shows ErrorState, NOT "down"
 *                 (per P5 invariant: an ERROR is not the same as DOWN).
 *  - `healthy`  → server answered AND health.ok === true.
 *  - `down`     → server answered AND health.ok === false.
 *
 * NOTE: a fourth value (`idle`) is intentionally NOT used here. Either
 * the server is pending, has errored, or it has answered. "idle" is a
 * semantics nobody can observe from the React Query state, so adding
 * it would be a fifth state with no observable difference from
 * `loading`.
 */
export type HealthState = 'down' | 'error' | 'healthy' | 'loading'

/**
 * Four-state truth surface for the `/api/metrics?window=24h` panel.
 *
 *  - `loading` → 24h query pending; UI shows skeleton, NOT zero.
 *  - `error`   → server call rejected; UI shows ErrorState.
 *  - `idle`    → server answered, but with no `alerts` array at all —
 *                 this is distinct from "loaded but empty". The view
 *                 renders an EmptyState under either `idle` or
 *                 `loaded`, but the difference is preserved so the
 *                 controller-side test can prove we did NOT fabricate
 *                 `activeAlerts = []` from a missing key.
 *  - `loaded`  → server answered with an `alerts` array (possibly
 *                 empty).
 *
 * `idle` MUST be the only path where `activeAlerts = []` is allowed
 * without a server-declared empty array on the wire.
 */
export type MetricsState = 'error' | 'idle' | 'loaded' | 'loading'

/**
 * Three-state truth surface for the whoami-snapshot identity panel.
 *
 *  - `authenticated` → server-declared whoami present.
 *  - `missing`       → session not yet answered / no whoami.
 *
 * `anonymous` is intentionally NOT a state. Per P5: when whoami is
 * null the session is "missing", never "anonymous-but-real".
 */
export type IdentityState = 'authenticated' | 'missing'

export interface DashboardViewModel {
  /** Page-level implementation status from the catalog (frozen contract). */
  pageStatus: 'blocked' | 'partial' | 'ready' | 'ready-dev'
  isReady: boolean
  isReadyDev: boolean
  isPartial: boolean
  isBlocked: boolean
  /** Shared VM (permission / capability surface). */
  canRead: boolean
  capabilityStatus: CapabilityStatus | null
  readOnlyReason: null | string
  /** Role-derived workspace copy. */
  workspace: WorkspaceCopy
  /** Health surface (server-declared, passed through; no fabrication). */
  health: null | Health
  healthPending: boolean
  healthError: null | string
  healthOk: null | boolean
  authMode: null | string
  /**
   * Server-truth health state. Four states — see `HealthState` for
   * the per-value semantics. Pure derivation; not persisted.
   */
  healthState: HealthState
  /** Auth mode collapsed to a string the view can render straight up. */
  authModeDisplay: string
  /** Metrics surface (server-declared). */
  metrics: null | Metrics
  metricsPending: boolean
  metricsError: null | string
  /**
   * Server-truth metrics state. Four states — see `MetricsState` for
   * the per-value semantics. Pure derivation; not persisted.
   */
  metricsState: MetricsState
  /** Server-declared alert list (raw — view renders each row). */
  activeAlerts: ReadonlyArray<{
    code: string | undefined
    level: string | undefined
    message: string | undefined
  }>
  /**
   * Alert count — pure derivation from `activeAlerts.length`. The view
   * uses this for the KPI tile so we don't have to re-derive inside
   * JSX. NO aggregation by level is computed here; that would invent
   * a server-truth KPI not present in the wire response.
   */
  alertsCount: number
  /**
   * Whether the server's answer carries an empty alerts list (length
   * === 0 with `metrics.alerts` either undefined or `[]`). Used so
   * the view can render a single `EmptyState` without ambiguity.
   */
  isAlertsListEmpty: boolean
  /** Server-declared capability count (LIVE + enabled). */
  liveCapabilityCount: number
  /** Session identity (server-declared). */
  whoami: null | Whoami
  /**
   * Server-truth identity state. Two states — see `IdentityState`.
   * Pure derivation; not persisted.
   */
  identityState: IdentityState
  /** Server-declared capability list (raw — view renders each row). */
  capabilityEntries: ReadonlyArray<readonly [string, { enabled: boolean; status: CapabilityStatus }]>
  hasNoCapabilities: boolean
  /** Title fallback for empty whoami. */
  pageTitle: string
}

/**
 * Compose the dashboard view-model.
 *
 * Inputs are server answers + the resolved whoami snapshot. No fetches
 * happen here. No permission is recomputed locally — we delegate to
 * `deriveCommonViewModel(whoami, page)` which delegates in turn to
 * `capabilities.hasPermission`.
 */
export function deriveDashboardViewModel(args: {
  page: ConsolePage
  whoami: null | Whoami
  health: null | Health
  healthPending: boolean
  healthError: unknown
  metrics: null | Metrics
  metricsPending: boolean
  metricsError: unknown
  capabilityName?: string
}): DashboardViewModel {
  const {
    page,
    whoami,
    health,
    healthPending,
    healthError,
    metrics,
    metricsPending,
    metricsError,
    capabilityName,
  } = args

  const common: CommonViewModelArgs = { whoami, page, capabilityName }

  const pageStatus = page.status
  const isReady = pageStatus === 'ready'
  const isReadyDev = pageStatus === 'ready-dev'
  const isPartial = pageStatus === 'partial'
  const isBlocked = pageStatus === 'blocked'

  const shared = deriveCommonViewModel(common)

  const workspace = workspaceCopy(whoami)

  const liveCapabilityCount = whoami
    ? Object.values(whoami.product_capabilities).filter(
        (cap) => cap.status === 'LIVE' && cap.enabled
      ).length
    : 0

  const activeAlerts: DashboardViewModel['activeAlerts'] = metrics
    ? (metrics.alerts ?? []).map((alert) => ({
        code: alert.code,
        level: alert.level,
        message: alert.message,
      }))
    : []

  const capabilityEntries = whoami
    ? Object.entries(whoami.product_capabilities)
    : []

  // capability chip status — server-only truth, never page.status fallback
  const chipStatus: CapabilityStatus | null = capabilityName
    ? capabilityStatus(whoami, capabilityName)
    : null

  // Derive the four-state health truth surface. The order matters:
  //   1. `loading` wins over data — fresh query → skeleton.
  //   2. `error`    wins over data — server refused to answer.
  //   3. `healthy` requires both: data present AND health.ok === true.
  //   4. `down`     is "answered but ok === false" — NEVER `request
  //                  failed → DOWN` (per P5 invariant).
  const healthState: HealthState = healthPending
    ? 'loading'
    : healthError
      ? 'error'
      : health
        ? health.ok
          ? 'healthy'
          : 'down'
        : 'error'

  // Mirror order: pending > error > answered.
  // An answered metrics payload WITHOUT an `alerts` array key is `idle`
  // — distinct from `loaded` (with an empty array). The view renders
  // EmptyState either way; the distinction prevents fabricating
  // `activeAlerts = []` from a missing key.
  const metricsState: MetricsState = metricsPending
    ? 'loading'
    : metricsError
      ? 'error'
      : metrics
        ? metrics.alerts === undefined
          ? 'idle'
          : 'loaded'
        : 'error'

  const identityState: IdentityState = whoami ? 'authenticated' : 'missing'
  const authModeDisplay = authMode0(health?.auth_mode ?? null)
  const alertsCount = activeAlerts.length
  const isAlertsListEmpty = alertsCount === 0

  return {
    pageStatus,
    isReady,
    isReadyDev,
    isPartial,
    isBlocked,
    canRead: shared.canRead,
    capabilityStatus: chipStatus ?? shared.capabilityStatus,
    readOnlyReason: shared.readOnlyReason,
    workspace,
    health,
    healthPending,
    healthError: healthError instanceof Error ? healthError.message : null,
    healthOk: health ? health.ok : null,
    authMode: health?.auth_mode ?? null,
    healthState,
    authModeDisplay,
    metrics,
    metricsPending,
    metricsError: metricsError instanceof Error ? metricsError.message : null,
    metricsState,
    activeAlerts,
    alertsCount,
    isAlertsListEmpty,
    liveCapabilityCount,
    whoami,
    identityState,
    capabilityEntries,
    hasNoCapabilities: capabilityEntries.length === 0,
    pageTitle: page.labelKey,
  }
}

/**
 * Server-truth auth mode with the em-dash fallback collapsed once.
 * Pure helper; keep private to this module.
 *
 * `null` → em dash (the same character used by `KpiCard.formatValue`
 * for missing numbers, so the whole dashboard feels uniform).
 */
function authMode0(mode: null | string): string {
  return mode ?? '—'
}

/** Resolve the ConsolePage from the catalog for the dashboard. */
export function dashboardPage(): ConsolePage {
  const page = findPage('dashboard')

  if (!page) {
    throw new Error('dashboard page missing from catalog')
  }

  return page
}