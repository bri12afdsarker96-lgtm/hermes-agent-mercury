/**
 * Dashboard page — Glue layer.
 *
 * Composes:
 *   - controller (useDashboardHealth, useDashboardMetrics, useWhoamiSnapshot)
 *   - view-model (deriveDashboardViewModel)
 *   - view (DashboardView)
 *
 * This file is the only place that wires those three together. It
 * contains no business logic — the controller owns server reads, the
 * view-model owns shape derivation, the view owns rendering.
 *
 * Visual output is identical to the pre-split page-dashboard.tsx. No
 * JSX or class names change. data-testid values are preserved.
 */

import {
  useDashboardHealth,
  useDashboardMetrics,
  useWhoamiSnapshot,
} from './page-dashboard.controller'
import { DashboardView } from './page-dashboard.view'
import {
  dashboardPage,
  deriveDashboardViewModel,
} from './page-dashboard.view-model'

export function DashboardPage() {
  const health = useDashboardHealth()
  const metrics = useDashboardMetrics()
  const whoami = useWhoamiSnapshot()
  const page = dashboardPage()

  const vm = deriveDashboardViewModel({
    page,
    whoami,
    health: health.data ?? null,
    healthPending: health.isPending,
    healthError: health.error,
    metrics: metrics.data ?? null,
    metricsPending: metrics.isPending,
    metricsError: metrics.error,
  })

  return <DashboardView vm={vm} />
}