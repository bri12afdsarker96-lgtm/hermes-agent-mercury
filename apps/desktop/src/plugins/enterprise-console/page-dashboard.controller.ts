/**
 * Dashboard page — Controller layer (Functional Controller).
 *
 * The controller owns the **only** server-touching surface for the
 * Dashboard:
 *   - the `/api/health` query (transport.get<Health>) at the EXACT
 *     pre-split React Query key `['enterprise-console', 'health']`
 *     so cache identity / observers / invalidation behavior are
 *     preserved.
 *   - the `/api/metrics?window=24h` query (transport.get<Metrics>) at
 *     the EXACT pre-split key `['enterprise-console', 'metrics', '24h']`.
 *   - the whoami snapshot via `useValue($whoami)` (read-only).
 *
 * The controller MUST NOT:
 *   - invent KPI fields that the server doesn't expose
 *   - fabricate server data
 *   - introduce a second auth / permission / capability engine
 *   - mutate the endpoint contract
 *   - change the React Query key identity (per W1-B1-REMEDIATION-01 §P4)
 *   - own presentation derivation — workspaceCopy lives in
 *     `view-model.ts` (per W1-B1-REMEDIATION-01 §P5 layer direction)
 */

import { useQuery, useValue } from '@hermes/plugin-sdk'

import { $whoami } from './session'
import { useTransport } from './transport'
import type { Health, Metrics, Whoami } from './types'

const HEALTH_KEY = ['enterprise-console', 'health'] as const
export const DASHBOARD_HEALTH_QUERY_KEY = [...HEALTH_KEY] as const
const HEALTH_REFETCH_MS = 30_000
export const DASHBOARD_HEALTH_REFETCH_MS = HEALTH_REFETCH_MS
const METRICS_KEY = ['enterprise-console', 'metrics', '24h'] as const
export const DASHBOARD_METRICS_QUERY_KEY = [...METRICS_KEY] as const
const METRICS_REFETCH_MS = 60_000
export const DASHBOARD_METRICS_REFETCH_MS = METRICS_REFETCH_MS

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