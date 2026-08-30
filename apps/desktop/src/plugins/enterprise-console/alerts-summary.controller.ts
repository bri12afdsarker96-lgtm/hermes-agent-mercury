/**
 * Alerts Summary — Controller (Lane C · P1.5 Alerts Summary).
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-01 · Lane C.
 *
 * Dedicated controller for the P1.5 Alerts Summary leaf component. Lives
 * alongside the existing dashboard controller without touching it; the
 * existing `page-alerts.tsx` continues to own the full-page Alerts &
 * exceptions view.
 *
 * REUSE-FIRST CENSUS (per GLOBAL G9 + §P6.3):
 *   - Endpoint: ``/api/metrics/alerts`` (existing, no new route).
 *   - Permission: ``metrics.view`` (existing, no new permission).
 *   - Query key: ``['enterprise-console', 'alerts-summary']`` (NEW namespace;
 *     does NOT collide with the existing ``['enterprise-console', 'alerts']``
 *     used by page-alerts.tsx — both can coexist).
 *   - React-Query primitives: re-uses ``useQuery`` from ``@hermes/plugin-sdk``.
 *   - Transport: re-uses ``useTransport()`` from ``./transport``.
 *
 * Per GLOBAL G10 (no second authority) and G14 (no second framework):
 *   - This controller does NOT introduce a new auth / permission /
 *     capability / state machine.
 *   - It does NOT change the existing page-alerts.tsx behavior.
 *
 * Per CONTINUATION-01 §P12 (Phase-1.5 Collision Design):
 *   - This controller is a LEAF-WRITER. The integrator (Lane C page-shell
 *     owner) is responsible for embedding the produced derivation in the
 *     Overview page via the existing dashboard slot composition.
 *   - This module does NOT modify page-dashboard.tsx, page-dashboard.view.tsx,
 *     or page-dashboard.view-model.ts.
 */

import { useQuery } from '@hermes/plugin-sdk'

import { useTransport } from './transport'

export interface MetricsAlertsAlert {
  code: string
  level: 'crit' | 'warn'
  message: string
  threshold: number
  value: number
}

export interface MetricsAlertsResp {
  alerts: MetricsAlertsAlert[]
  errors: Record<string, string>
  generated_ts: number
}

export interface AlertsSummaryDerivation {
  criticalCount: number
  warningCount: number
  sourceErrorCount: number
  totalAlerts: number
  /** When the upstream response was last generated. */
  generatedTs: number
  /** True when the derivation successfully produced counts. */
  ok: boolean
}

const ALERTS_SUMMARY_QUERY_KEY = [
  'enterprise-console',
  'alerts-summary',
] as const

export const ALERTS_SUMMARY_QUERY_KEY_EXPORT = [
  ...ALERTS_SUMMARY_QUERY_KEY,
] as const

const ALERTS_REFETCH_MS = 60_000

export interface UseAlertsSummaryOptions {
  /** Override the default refetch interval (ms). */
  refetchInterval?: number
  /** Disable the query (e.g. when caller does not have metrics.view). */
  enabled?: boolean
}

/**
 * Fetch /api/metrics/alerts and derive a compact summary for the
 * Overview / Basic Health card. Pure derivation — no fake counts.
 *
 * Returns `data` of type ``AlertsSummaryDerivation`` when the upstream
 * resolves; `data` is ``undefined`` while loading or on error.
 */
export function useAlertsSummary(options: UseAlertsSummaryOptions = {}) {
  const transport = useTransport()

  return useQuery<AlertsSummaryDerivation, MetricsAlertsResp>({
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const resp = await transport.get<MetricsAlertsResp>('/api/metrics/alerts')
      return deriveAlertsSummary(resp)
    },
    queryKey: [...ALERTS_SUMMARY_QUERY_KEY],
    refetchInterval: options.refetchInterval ?? ALERTS_REFETCH_MS,
  })
}

/**
 * Pure: derive a compact summary from the upstream MetricsAlertsResp.
 * Exposed for testing and for the integrator's view-model to reuse.
 */
export function deriveAlertsSummary(
  resp: MetricsAlertsResp | null | undefined,
): AlertsSummaryDerivation {
  if (!resp) {
    return {
      criticalCount: 0,
      warningCount: 0,
      sourceErrorCount: 0,
      totalAlerts: 0,
      generatedTs: 0,
      ok: false,
    }
  }
  let criticalCount = 0
  let warningCount = 0
  for (const a of resp.alerts ?? []) {
    if (a.level === 'crit') criticalCount += 1
    else if (a.level === 'warn') warningCount += 1
  }
  const sourceErrorCount = Object.keys(resp.errors ?? {}).length
  return {
    criticalCount,
    warningCount,
    sourceErrorCount,
    totalAlerts: criticalCount + warningCount,
    generatedTs: resp.generated_ts ?? 0,
    ok: true,
  }
}
