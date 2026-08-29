/**
 * Alerts & Exceptions page — Presentational view.
 *
 * Receives an `AlertsViewModel` and renders. No transport, no query
 * hooks, no session atoms. Wave 1 / Step 5 of W5-B0 contract freeze.
 *
 * The eslint config at `apps/desktop/eslint.config.mjs` enforces
 * VIEW_FORBIDDEN_IMPORTS on this file via `no-restricted-imports`.
 */

import { StatusDot } from '@hermes/plugin-sdk'

import { type AlertsViewModel } from './page-alerts.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, ConsoleRows, PageHeader } from './ui'

export interface AlertsViewProps {
  vm: AlertsViewModel
}

export function AlertsView({ vm }: AlertsViewProps) {
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

      {vm.isEmpty ? (
        <p className="text-(--ui-text-tertiary)" data-testid="console-alerts-empty">
          no active alerts
        </p>
      ) : (
        <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
          {vm.alerts.length > 0 ? (
            <ConsolePanel divided title="Active alerts">
              <ConsoleRows testId="console-alerts">
                {vm.alerts.map(alert => (
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
                      <StatusDot tone={alert.tone} />
                      {alert.level}
                    </span>
                  </li>
                ))}
              </ConsoleRows>
            </ConsolePanel>
          ) : null}

          <ConsolePanel divided title="Source errors">
            {vm.errors.length > 0 ? (
              <dl className="flex flex-col" data-testid="console-alert-errors">
                {vm.errors.map(({ source, detail }) => (
                  <div
                    className="border-b border-(--ui-stroke-tertiary) py-3 last:border-b-0"
                    key={source}
                  >
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
    </div>
  )
}