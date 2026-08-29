/**
 * Dashboard page — Controller layer (Functional Controller).
 *
 * The controller owns the **only** server-touching surface for the
 * Dashboard:
 *   - the `/api/health` query (transport.get<Health>)
 *   - the `/api/metrics?window=24h` query (transport.get<Metrics>)
 *
 * and the presentation-state orchestration:
 *   - `useValue($whoami)` for the workspace copy (operator / supervisor /
 *     tenant_admin / super_admin / default)
 *   - the LIVE-capability count derived from
 *     `whoami.product_capabilities` (server-declared runtime truth)
 *
 * The controller MUST NOT:
 *   - invent KPI fields that the server doesn't expose
 *   - fabricate server data
 *   - introduce a second auth / permission / capability engine
 *   - mutate the endpoint contract
 *
 * All shape decisions for the view live in `view-model.ts` (pure
 * derivation); all rendering lives in `view.tsx`. The controller
 * here returns the raw server answers + `whoami` snapshot + the
 * workspaceCopy lookup. The view-model composes them into a
 * `DashboardViewModel` the view consumes.
 */

import { useQuery, useValue } from '@hermes/plugin-sdk'

import { $whoami } from './session'
import { useTransport } from './transport'
import type { Health, Metrics, Whoami } from './types'

const HEALTH_KEY = ['enterprise-console', 'dashboard', 'health'] as const
const HEALTH_REFETCH_MS = 30_000
const METRICS_KEY = ['enterprise-console', 'dashboard', 'metrics', '24h'] as const
const METRICS_REFETCH_MS = 60_000

export function useDashboardHealth() {
  const transport = useTransport()

  return useQuery({
    queryFn: () => transport.get<Health>('/api/health'),
    queryKey: [...HEALTH_KEY],
    refetchInterval: HEALTH_REFETCH_MS,
  })
}

export function useDashboardMetrics() {
  const transport = useTransport()

  return useQuery({
    queryFn: () => transport.get<Metrics>('/api/metrics?window=24h'),
    queryKey: [...METRICS_KEY],
    refetchInterval: METRICS_REFETCH_MS,
  })
}

export function useWhoamiSnapshot(): null | Whoami {
  return useValue($whoami)
}

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