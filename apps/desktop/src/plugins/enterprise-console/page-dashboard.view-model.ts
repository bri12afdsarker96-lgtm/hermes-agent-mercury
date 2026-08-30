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

/**
 * Alerts Summary (Phase-1.5) — a compact Overview tile group, derived
 * purely from the `/api/metrics?window=24h` server answer that the
 * dashboard controller already owns. No new server route, no new
 * permission (P3 of the C-line contract).
 *
 * AUTHORITY NOTE (REMEDIATION-01):
 *   `/api/metrics/alerts` and `/api/metrics?window=24h` BOTH derive
 *   from the same `compute_metrics_window("24h")` server authority.
 *   Per TOTAL-CONTROL §4 we reuse the dashboard's already-fetched
 *   response — adding a second alerts query would duplicate the same
 *   authoritative payload. The dashboard route is the canonical
 *   transport surface; `/api/metrics/alerts` is just a project that
 *   endpoint produces (and is what `page-alerts.tsx` consumes).
 *
 * STATES — the honest verdict on what we can show right now:
 *   - `loading`              : metrics query still pending
 *   - `permission-unavailable`: viewer lacks `metrics.view`
 *   - `server-unavailable`   : metrics query errored OR server never
 *                              returned a payload (`metrics == null`
 *                              after pending=false and error=null)
 *   - `available-empty`      : real server payload, no alerts, no
 *                              source errors (all error entries are
 *                              null / empty / absent)
 *   - `available-alerts`     : real server payload, at least one alert
 *                              row, source data clean
 *   - `source-errors`        : real server payload, ≥1 source reports a
 *                              degraded condition; counts may still
 *                              render but the operator sees the
 *                              degradation explicitly
 *
 * Critical / Warning counts narrow to the EXACT server strings
 * `'crit'` / `'warn'`. Unknown / missing levels do NOT inflate those
 * tiles but they still count toward `rawAlertCount` and pull the state
 * out of `available-empty` (an honest unread alert is not "no alerts").
 *
 * Source Errors count (REMEDIATION-01 §7):
 *   Only actual non-null / non-empty error strings count. A healthy
 *   server payload `errors = { audit: null, inbox: null, kbgaps: null }`
 *   returns 0 source errors — NOT 3. We accept the loose
 *   `Metrics.errors: Record<string, number>` frozen type but NORMALIZE
 *   at the C-owned derivation boundary (do NOT touch `types.ts`).
 *
 * "NO DATA != ZERO ALERTS". `metrics == null` is NOT `available-empty`;
 * it is `server-unavailable`. An authoritative 0 requires a real
 * payload whose `errors` map contains no actual error conditions and
 * whose `alerts` array is empty (or contains only unclassified rows
 * that count toward `rawAlertCount`).
 */
export type AlertsSummaryState =
  | 'available-alerts'
  | 'available-empty'
  | 'data-degraded'
  | 'loading'
  | 'permission-unavailable'
  | 'server-unavailable'
  | 'source-errors'

export interface AlertsSummary {
  /** Honest verdict on what we can show right now. */
  state: AlertsSummaryState
  /** Count of `level === 'crit'` items in `metrics.alerts`. null = no honest answer. */
  critical: null | number
  /** Count of `level === 'warn'` items in `metrics.alerts`. null = no honest answer. */
  warning: null | number
  /**
   * Count of ACTUAL source-error conditions in `metrics.errors`. A
   * `null` / empty-string / absent value is NOT an error. null = no
   * honest answer.
   */
  sourceErrors: null | number
  /**
   * Count of `metrics.alerts` rows whose level is neither `'crit'`
   * nor `'warn'` (info / debug / missing / unexpected). Surfaces
   * honest unread alerts without inflating Critical/Warning tiles.
   * null = no honest answer.
   */
  unclassifiedAlertCount: null | number
  /** Total raw alert rows (useful when state is `available-alerts`
   *  with 0 recognized crit/warn — i.e. there ARE alerts, just none
   *  we can classify). null = no honest answer. */
  rawAlertCount: null | number
}

/**
 * Count ACTUAL source-error conditions in a server runtime errors map.
 *
 * Server shape (REMEDIATION-01 §6): `{ audit: string | null, inbox: string
 * | null, kbgaps: string | null }` where a `null` value means the
 * source answered cleanly and any non-null / non-empty string means a
 * degraded / failed collection.
 *
 * Rules:
 *   - not an object → 0 (no honest answer at the SHAPE level; the
 *     caller will surface `server-unavailable` via other signals)
 *   - `null` / `undefined` value → not an error
 *   - empty-string value → not an error (defensive — server is not
 *     expected to emit "" but if it does we treat it as "no detail")
 *   - non-empty string → 1
 *   - unexpected type (number / object / boolean) → 1 (malformed;
 *     counts as degraded to avoid hiding the truth)
 *
 * We accept the frozen loose `Record<string, number>` type by
 * narrowing at this C-owned boundary — `types.ts` is not touched in
 * this Lane.
 */
export function countSourceErrors(errors: unknown): number {
  if (errors === null || typeof errors !== 'object') {
    return 0
  }

  let count = 0

  for (const value of Object.values(errors as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      continue
    }

    if (typeof value === 'string') {
      if (value.length > 0) {
        count += 1
      }

      continue
    }

    // Unexpected non-string / non-null shape (e.g. legacy number from
    // a stale payload). The frozen `types.ts` declares
    // `Record<string, number>` for back-compat; we surface those as
    // degraded rather than silently treating them as healthy.
    count += 1
  }

  return count
}

/**
 * Pure derivation. Inputs are the controller's already-resolved values;
 * no fetches happen here.
 *
 * STATE PRECEDENCE (REMEDIATION-01 §12, first match wins):
 *   1. !canRead                                  -> permission-unavailable
 *   2. metricsPending                            -> loading
 *   3. metricsError !== null                     -> server-unavailable
 *   4. metrics == null                           -> server-unavailable
 *      (no payload at all is NOT "no alerts" — that would lie)
 *   5. countSourceErrors(metrics.errors) > 0    -> source-errors
 *   6. rawAlertCount > 0                         -> available-alerts
 *      (covers crit+warn rows AND unclassified rows)
 *   7. else                                      -> available-empty
 *
 * Counts remain populated at steps 5 and 6 (server DID answer; we
 * honour its facts and label the state honestly). Counts are `null`
 * at steps 1–4 (no honest answer available).
 *
 * Permission authority is delegated to `canRead` (which itself
 * delegates to `capabilities.hasPermission`). We do NOT introduce a
 * second permission engine.
 */
export function deriveAlertsSummary(args: {
  canRead: boolean
  metrics: null | Metrics
  metricsPending: boolean
  metricsError: null | string
}): AlertsSummary {
  const { canRead, metrics, metricsPending, metricsError } = args

  if (!canRead) {
    return {
      critical: null,
      rawAlertCount: null,
      sourceErrors: null,
      state: 'permission-unavailable',
      unclassifiedAlertCount: null,
      warning: null,
    }
  }

  if (metricsPending) {
    return {
      critical: null,
      rawAlertCount: null,
      sourceErrors: null,
      state: 'loading',
      unclassifiedAlertCount: null,
      warning: null,
    }
  }

  if (metricsError !== null) {
    return {
      critical: null,
      rawAlertCount: null,
      sourceErrors: null,
      state: 'server-unavailable',
      unclassifiedAlertCount: null,
      warning: null,
    }
  }

  if (metrics === null) {
    // The controller resolved `metrics` to null with no error and no
    // pending flag. That means the server did not return a payload —
    // either a soft failure upstream or a never-answered request. This
    // is NOT an authoritative empty answer; it is an unanswerable
    // question. We surface `server-unavailable` with em-dashes for
    // every count (P5 of the original C-line contract).
    return {
      critical: null,
      rawAlertCount: null,
      sourceErrors: null,
      state: 'server-unavailable',
      unclassifiedAlertCount: null,
      warning: null,
    }
  }

  const alerts = metrics.alerts ?? []
  const critical = alerts.filter((alert) => alert?.level === 'crit').length
  const warning = alerts.filter((alert) => alert?.level === 'warn').length

  const unclassifiedAlertCount = alerts.filter(
    (alert) => alert?.level !== 'crit' && alert?.level !== 'warn'
  ).length

  const rawAlertCount = alerts.length
  const sourceErrors = countSourceErrors(metrics.errors)

  let state: AlertsSummaryState

  if (sourceErrors > 0) {
    state = 'source-errors'
  } else if (rawAlertCount > 0) {
    // Includes both classified (crit/warn) and unclassified rows.
    // An alert the server gave us with an unknown level is still an
    // alert — we must NOT label the surface as `available-empty`.
    state = 'available-alerts'
  } else {
    state = 'available-empty'
  }

  return {
    critical,
    rawAlertCount,
    sourceErrors,
    state,
    unclassifiedAlertCount,
    warning,
  }
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
  /** Metrics surface (server-declared). */
  metrics: null | Metrics
  metricsPending: boolean
  metricsError: null | string
  /** Server-declared alert list (raw — view renders each row). */
  activeAlerts: ReadonlyArray<{
    code: string | undefined
    level: string | undefined
    message: string | undefined
  }>
  /**
   * Phase-1.5 Alerts Summary — compact counts derived from the SAME
   * `/api/metrics?window=24h` server answer that already feeds
   * `activeAlerts`. The view renders three KPI tiles (Critical /
   * Warning / Source Errors) plus an explicit state (loading / empty /
   * available / source errors / server unavailable / permission
   * unavailable). No new server route, no new permission — see P3 of
   * the C-line contract. Counts are `null` whenever the server has
   * not given an honest answer (loading / unavailable / permission
   * denied) — we never coerce absent data to 0.
   */
  alertsSummary: AlertsSummary
  /** Server-declared capability count (LIVE + enabled). */
  liveCapabilityCount: number
  /** Session identity (server-declared). */
  whoami: null | Whoami
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

  const alertsSummary = deriveAlertsSummary({
    canRead: shared.canRead,
    metrics,
    metricsPending,
    metricsError: metricsError instanceof Error ? metricsError.message : null,
  })

  const capabilityEntries = whoami
    ? Object.entries(whoami.product_capabilities)
    : []

  // capability chip status — server-only truth, never page.status fallback
  const chipStatus: CapabilityStatus | null = capabilityName
    ? capabilityStatus(whoami, capabilityName)
    : null

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
    metrics,
    metricsPending,
    metricsError: metricsError instanceof Error ? metricsError.message : null,
    activeAlerts,
    alertsSummary,
    liveCapabilityCount,
    whoami,
    capabilityEntries,
    hasNoCapabilities: capabilityEntries.length === 0,
    pageTitle: page.labelKey,
  }
}

/** Resolve the ConsolePage from the catalog for the dashboard. */
export function dashboardPage(): ConsolePage {
  const page = findPage('dashboard')

  if (!page) {
    throw new Error('dashboard page missing from catalog')
  }

  return page
}