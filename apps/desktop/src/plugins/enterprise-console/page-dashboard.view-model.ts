/**
 * Dashboard / Service Health — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * Five presentation fields:
 *   - workspaceCopy (purpose + title by role)
 *   - health: ok/down + auth_mode (or em-dash if pending/error)
 *   - metrics: 24h alerts list + KPI count (em-dash if pending/error)
 *   - capabilities: product_capabilities key/value pairs + LIVE count
 *   - session: whoami principal / tenant / role or null
 *
 * Wave 1 / Step 13 of W5-B0 Controller/View Contract Freeze.
 */

import type { CapabilityStatus, Whoami } from './types'

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { Health, Metrics, WorkspaceCopy } from './page-dashboard.controller'

export interface DashboardHealth {
  authMode: string
  okLabel: 'down' | 'ok'
  state: 'loading' | 'error' | 'ready'
}

export interface DashboardMetricAlert {
  code: string
  level: null | string
  message: null | string
}

export interface DashboardMetrics {
  alertCount: null | number
  alerts: readonly DashboardMetricAlert[]
  state: 'loading' | 'error' | 'ready'
}

export interface DashboardCapabilityRow {
  capabilityStatus: CapabilityStatus
  key: string
}

export interface DashboardSession {
  name: string
  role: string
  tenantId: null | string
}

export interface DashboardViewModel extends CommonViewModelFields {
  capabilities: readonly DashboardCapabilityRow[]
  copy: WorkspaceCopy
  health: DashboardHealth
  liveCapabilityCount: null | number
  metrics: DashboardMetrics
  session: null | DashboardSession
}

export interface DashboardViewModelArgs {
  copy: WorkspaceCopy
  health: { data: Health | undefined; error: unknown; isPending: boolean }
  metrics: { data: Metrics | undefined; error: unknown; isPending: boolean }
  page: ConsolePage
  whoami: null | Whoami
}

function deriveHealth(args: { data: Health | undefined; error: unknown; isPending: boolean }): DashboardHealth {
  if (args.isPending) {
    return { authMode: '—', okLabel: 'ok', state: 'loading' }
  }

  if (args.error || !args.data) {
    return { authMode: '—', okLabel: 'ok', state: 'error' }
  }

  return {
    authMode: args.data.auth_mode,
    okLabel: args.data.ok ? 'ok' : 'down',
    state: 'ready',
  }
}

function deriveMetrics(args: { data: Metrics | undefined; error: unknown; isPending: boolean }): DashboardMetrics {
  if (args.isPending) {
    return { alertCount: null, alerts: [], state: 'loading' }
  }

  if (args.error || !args.data) {
    return { alertCount: null, alerts: [], state: 'error' }
  }

  const alerts = (args.data.alerts ?? []).map(alert => ({
    code: alert.code ?? '',
    level: alert.level ?? null,
    message: alert.message ?? null,
  }))

  return {
    alertCount: alerts.length,
    alerts,
    state: 'ready',
  }
}

function deriveCapabilities(who: null | Whoami): {
  capabilities: readonly DashboardCapabilityRow[]
  liveCount: null | number
} {
  if (!who) {
    return { capabilities: [], liveCount: null }
  }

  const entries = Object.entries(who.product_capabilities ?? {})
  const capabilities: DashboardCapabilityRow[] = entries.map(([key, value]) => ({
    key,
    capabilityStatus: value.status,
  }))
  const liveCount = entries.filter(([, value]) => value.status === 'LIVE' && value.enabled).length

  return { capabilities, liveCount }
}

function deriveSession(who: null | Whoami): null | DashboardSession {
  if (!who) {
    return null
  }

  return {
    name: who.name,
    role: who.role,
    tenantId: who.tenant_id,
  }
}

export function deriveDashboardViewModel(args: DashboardViewModelArgs): DashboardViewModel {
  const { copy, health, metrics, page, whoami } = args
  const common = deriveCommonViewModel({ page, whoami })

  const { capabilities, liveCount } = deriveCapabilities(whoami)

  return {
    ...common,
    copy,
    health: deriveHealth(health),
    metrics: deriveMetrics(metrics),
    capabilities,
    liveCapabilityCount: liveCount,
    session: deriveSession(whoami),
  }
}