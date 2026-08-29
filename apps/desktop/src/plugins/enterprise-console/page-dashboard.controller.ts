/**
 * Dashboard / Service Health — Controller layer.
 *
 * READ-ONLY (no mutation): the dashboard composes server facts
 * (`/api/health`, `/api/metrics?window=24h`) plus the whoami session
 * atom into the frozen presentation layer. Permission and capability
 * truth remain B-owned.
 *
 * The workspace copy switch is a pure function — lives in the
 * controller's data shape so the view can render it without branching
 * on `who.role`.
 *
 * Wave 1 / Step 13 of W5-B0 Controller/View Contract Freeze.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import type { Health, Metrics, Whoami } from './types'
import { useTransport } from './transport'

export const HEALTH_KEY = ['enterprise-console', 'health'] as const
export const METRICS_24H_KEY = ['enterprise-console', 'metrics', '24h'] as const

export const HEALTH_REFETCH_INTERVAL_MS = 30_000
export const METRICS_REFETCH_INTERVAL_MS = 60_000

export function useHealthData() {
  const transport = useTransport()

  return useConsoleQuery<Health>(HEALTH_KEY, '/api/health', HEALTH_REFETCH_INTERVAL_MS)
}

export function useMetrics24hData() {
  const transport = useTransport()

  return useConsoleQuery<Metrics>(METRICS_24H_KEY, '/api/metrics?window=24h', METRICS_REFETCH_INTERVAL_MS)
}

export interface WorkspaceCopy {
  purpose: string
  title: string
}

/** Workspace copy is derived from the server-declared role. The view
 *  never branches on `who.role` itself — the controller computes the
 *  presentation copy. */
export function workspaceCopy(who: Whoami | null): WorkspaceCopy {
  switch (who?.role) {
    case 'operator':
      return {
        purpose: 'Your authenticated operational workspace, current service health and capability truth.',
        title: 'Operator Home',
      }
    case 'supervisor':
      return {
        purpose: 'Supervisory workspace for current service health, scoped operations and capability truth.',
        title: 'Supervisor Workspace',
      }
    case 'tenant_admin':
    case 'super_admin':
      return {
        purpose: 'Tenant administration overview for service health, authenticated scope and capability truth.',
        title: 'Tenant Admin Overview',
      }
    default:
      return {
        purpose: 'Server health, authenticated workspace identity and current capability truth.',
        title: 'Workspace',
      }
  }
}

export function normalizeDashboardError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'metrics.view permission required'
    }

    if (e.code === 'not_implemented') {
      return 'dashboard endpoints are not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}