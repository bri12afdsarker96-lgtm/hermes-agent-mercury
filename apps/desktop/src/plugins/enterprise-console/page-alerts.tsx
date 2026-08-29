/**
 * Alerts / Exceptions page — real `/api/metrics/alerts`. Field names are the
 * server's actual shape: `{ level, code, value, threshold, message }` plus a
 * per-source `errors` map (NOT `severity/kind/detail`).
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { ConsoleRows, QueryBody, useConsoleQuery } from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

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
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-alerts"
    >
      <PageHeader
        purpose="Current server-reported alert conditions and source-level collection errors."
        status={<PageStatusBadge status="ready" />}
        title="Alerts & exceptions"
      />

      <QueryBody
        emptyText="no active alerts"
        isEmpty={data => data.alerts.length === 0 && Object.keys(data.errors ?? {}).length === 0}
        query={query}
      >
        {data => (
          <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
            <ConsolePanel divided title="Active alerts">
              <ConsoleRows testId="console-alerts">
                {data.alerts.map(alert => (
                  <li
                    className="flex min-h-14 items-center justify-between gap-4 border-b border-(--ui-stroke-tertiary) py-3 last:border-b-0"
                    key={alert.code}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-(--ui-text-primary)">{alert.message}</div>
                      <div className="text-(--ui-text-tertiary)" data-ec-mono="">
                        {alert.code} · {alert.value}/{alert.threshold}
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 uppercase text-(--ui-text-secondary)">
                      <StatusDot tone={LEVEL_TONE[alert.level] ?? 'warn'} />
                      {alert.level}
                    </span>
                  </li>
                ))}
              </ConsoleRows>
            </ConsolePanel>

            <ConsolePanel divided title="Source errors">
              {Object.entries(data.errors ?? {}).length > 0 ? (
                <dl className="flex flex-col" data-testid="console-alert-errors">
                  {Object.entries(data.errors).map(([source, detail]) => (
                    <div className="border-b border-(--ui-stroke-tertiary) py-3 last:border-b-0" key={source}>
                      <dt className="font-medium text-(--ui-text-primary)" data-ec-mono="">
                        {source}
                      </dt>
                      <dd className="mt-1 break-words text-(--ui-text-secondary)">{detail}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-(--ui-text-tertiary)">no source errors</p>
              )}
            </ConsolePanel>
          </div>
        )}
      </QueryBody>
    </div>
  )
}
