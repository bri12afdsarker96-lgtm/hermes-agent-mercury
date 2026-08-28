/**
 * Alerts / Exceptions page — real `/api/metrics/alerts`. Field names are the
 * server's actual shape: `{ level, code, value, threshold, message }` plus a
 * per-source `errors` map (NOT `severity/kind/detail`).
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { ConsoleRows, QueryBody, useConsoleQuery } from './page-kit'

interface MetricAlert {
  code: string
  level: 'crit' | 'warn'
  message: string
  threshold: number
  value: number
}

interface MetricsAlertsResp {
  alerts: MetricAlert[]
  errors: Record<string, string>
  generated_ts: number
}

const LEVEL_TONE: Record<string, StatusTone> = { crit: 'bad', warn: 'warn' }

export function AlertsPage() {
  const query = useConsoleQuery<MetricsAlertsResp>(['enterprise-console', 'alerts'], '/api/metrics/alerts', 60_000)

  return (
    <div data-page-status="ready" data-testid="console-page-alerts">
      <QueryBody
        emptyText="no active alerts"
        isEmpty={data => data.alerts.length === 0 && Object.keys(data.errors ?? {}).length === 0}
        query={query}
      >
        {data => (
          <div className="flex flex-col gap-3">
            <ConsoleRows testId="console-alerts">
              {data.alerts.map(alert => (
                <li
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                  key={alert.code}
                >
                  <div className="min-w-0">
                    <div className="truncate">{alert.message}</div>
                    <div className="text-xs text-muted-foreground">
                      {alert.code} · {alert.value}/{alert.threshold}
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs uppercase">
                    <StatusDot tone={LEVEL_TONE[alert.level] ?? 'warn'} />
                    {alert.level}
                  </span>
                </li>
              ))}
            </ConsoleRows>
            {Object.entries(data.errors ?? {}).length > 0 ? (
              <div className="rounded-md border border-border p-2" data-testid="console-alert-errors">
                <div className="mb-1 text-xs font-medium text-muted-foreground">source errors</div>
                {Object.entries(data.errors).map(([source, detail]) => (
                  <div className="text-xs" key={source}>
                    {source}: {detail}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </QueryBody>
    </div>
  )
}
