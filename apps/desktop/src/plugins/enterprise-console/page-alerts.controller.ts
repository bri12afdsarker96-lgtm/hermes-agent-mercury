/**
 * Alerts & Exceptions page — Controller layer.
 *
 * Holds the HermesTransport query for the metrics alerts endpoint, the
 * queryKey (single source of truth for React Query invalidation), and
 * the wire-shape interfaces. Nothing here imports JSX or view
 * primitives.
 *
 * Wave 1 / Step 5 of W5-B0 Controller/View Contract Freeze. See
 * .hermes/plans/2026-08-29_wave1-contract-freeze.md §3.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

/** Wire shape for `/api/metrics/alerts` (single real endpoint). Field
 *  names are the server's actual shape: `{ level, code, value,
 *  threshold, message }` plus a per-source `errors` map. */
export interface MetricAlert {
  code: string
  level: 'crit' | 'warn'
  message: string
  threshold: number
  value: number
}

export interface MetricsAlertsResp {
  alerts: MetricAlert[]
  errors: Record<string, string>
  generated_ts: number
}

export const ALERTS_KEY = ['enterprise-console', 'alerts'] as const

/** Polling cadence: 60s (server recomputes source error maps every minute). */
export const ALERTS_REFETCH_INTERVAL_MS = 60_000

/** Read-only query hook. No mutations exist for alerts in Phase-1 — the
 *  server deliberately exposes no operator ack/silence/assign action
 *  (handoff §3.5 + catalog.ts controlStatus='ready' but write surface
 *  is intentionally absent). */
export function useAlertsData() {
  const transport = useTransport()

  return useConsoleQuery<MetricsAlertsResp>(
    ALERTS_KEY,
    '/api/metrics/alerts',
    ALERTS_REFETCH_INTERVAL_MS,
  )
}

/** Human-readable error after HermesApiError / generic Error → string. */
export function normalizeAlertsError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'metrics.view permission required'
    }

    if (e.code === 'not_implemented') {
      return 'metrics/alerts endpoint is not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}