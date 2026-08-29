/**
 * Dashboard / Service Health — Presentational view.
 *
 * Receives a DashboardViewModel. Renders:
 *   - PageHeader with role-derived copy
 *   - 3 KPI cards (Hermes service / Active alerts / Live capabilities)
 *   - Session panel (principal / tenant / role)
 *   - Capabilities panel
 *   - Active alerts panel (within Metrics card)
 *
 * The eslint config enforces VIEW_FORBIDDEN_IMPORTS.
 *
 * Wave 1 / Step 13 of W5-B0 contract freeze.
 */

import { EmptyState, ErrorState, Loader, icons as sdkIcons } from '@hermes/plugin-sdk'

import type { DashboardViewModel } from './page-dashboard.view-model'
import { CapabilityBadge, PageStatusBadge } from './status-badge'
import { ConsolePanel, KpiCard, PageHeader } from './ui'

export interface DashboardViewProps {
  vm: DashboardViewModel
  /** Auth-mode label key lookup. The view never imports i18n hooks. */
  t: (key: string) => string
}

export function DashboardView({ vm, t }: DashboardViewProps) {
  const healthIcon = sdkIcons.Activity
  const alertsIcon = sdkIcons.Bell
  const liveCapabilitiesIcon = sdkIcons.Layers3

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-dashboard"
    >
      <PageHeader
        purpose={vm.copy.purpose}
        status={<PageStatusBadge status="ready" />}
        title={vm.copy.title}
      />

      <div className="grid gap-(--ec-gutter) md:grid-cols-2 xl:grid-cols-3">
        {/* Hermes service */}
        {vm.health.state === 'loading' ? (
          <div className="min-h-28" data-testid="console-health">
            <Loader />
          </div>
        ) : vm.health.state === 'error' ? (
          <div data-testid="console-health">
            <ErrorState description="health" title="health" />
          </div>
        ) : (
          <div data-testid="console-health">
            <KpiCard accent="brand" icon={healthIcon} label="Hermes service" value={vm.health.okLabel} />
            <span className="sr-only" data-testid="console-health-ok">
              {vm.health.okLabel}
            </span>
            <p className="mt-2 text-(--ui-text-secondary)">
              {t('session.authMode')}: <span data-ec-mono="">{vm.health.authMode}</span>
            </p>
          </div>
        )}

        {/* Active alerts · 24h */}
        {vm.metrics.state === 'loading' ? (
          <KpiCard accent="takeover" icon={alertsIcon} label="Active alerts · 24h" loading />
        ) : vm.metrics.state === 'error' ? (
          <ErrorState description="metrics" title="metrics" />
        ) : (
          <div className="flex flex-col gap-3">
            <KpiCard
              accent="takeover"
              icon={alertsIcon}
              label="Active alerts · 24h"
              value={vm.metrics.alertCount ?? 0}
            />
            <ConsolePanel divided title="Active alerts">
              {vm.metrics.alerts.length === 0 ? (
                <EmptyState className="min-h-20" title="no active alerts" />
              ) : (
                <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-alerts">
                  {vm.metrics.alerts.map((alert, index) => (
                    <li className="flex items-start justify-between gap-4 py-3" key={alert.code || `alert-${index}`}>
                      <div className="min-w-0">
                        <div className="font-medium text-(--ui-text-primary)">
                          {alert.message ?? alert.code ?? 'alert'}
                        </div>
                        {alert.code ? (
                          <div className="mt-0.5 text-(--ui-text-tertiary)" data-ec-mono="">
                            {alert.code}
                          </div>
                        ) : null}
                      </div>
                      {alert.level ? (
                        <span className="shrink-0 text-(--ui-text-secondary)" data-ec-mono="">
                          {alert.level}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </ConsolePanel>
          </div>
        )}

        {/* Live capabilities */}
        <KpiCard
          accent="knowledge"
          icon={liveCapabilitiesIcon}
          label="Live capabilities"
          value={vm.liveCapabilityCount ?? 0}
        />
      </div>

      <div className="mt-(--ec-gutter) grid items-start gap-(--ec-gutter) xl:grid-cols-2">
        {/* Session */}
        {vm.session ? (
          <ConsolePanel title={t('session.principal')}>
            <dl
              className="grid grid-cols-[minmax(7rem,0.35fr)_minmax(0,1fr)] gap-x-5 gap-y-3"
              data-testid="console-session"
            >
              <dt className="text-(--ui-text-secondary)">{t('session.principal')}</dt>
              <dd className="min-w-0 truncate font-medium text-(--ui-text-primary)">{vm.session.name}</dd>
              <dt className="text-(--ui-text-secondary)">{t('session.tenant')}</dt>
              <dd className="min-w-0 truncate text-(--ui-text-primary)" data-ec-mono="">
                {vm.session.tenantId ?? '—'}
              </dd>
              <dt className="text-(--ui-text-secondary)">{t('session.role')}</dt>
              <dd className="min-w-0 truncate text-(--ui-text-primary)" data-ec-mono="">
                {vm.session.role}
              </dd>
            </dl>
          </ConsolePanel>
        ) : null}

        {/* Capabilities */}
        {vm.capabilities.length > 0 ? (
          <ConsolePanel divided title="Capabilities">
            <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-capabilities">
              {vm.capabilities.map(cap => (
                <li className="flex min-h-10 items-center justify-between gap-3 py-2" key={cap.key}>
                  <span className="min-w-0 truncate text-(--ui-text-primary)" data-ec-mono="">
                    {cap.key}
                  </span>
                  <CapabilityBadge status={cap.capabilityStatus} />
                </li>
              ))}
            </ul>
          </ConsolePanel>
        ) : null}
      </div>
    </div>
  )
}