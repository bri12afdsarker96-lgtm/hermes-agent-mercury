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