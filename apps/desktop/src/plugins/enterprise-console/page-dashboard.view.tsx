/**
 * Dashboard page — Presentational View layer.
 *
 * Receives a fully-derived `DashboardViewModel` and renders. No
 * transport, no useValue, no $whoami — only the VM the controller +
 * view-model composed.
 *
 * The ESLint W1-A boundary (apps/desktop/eslint.config.mjs) constrains
 * any `*.view.tsx` to NOT import from `./transport`, `./fetch-transport`,
 * `./page-kit` (controller helpers), `./session` (raw $whoami),
 * `./capabilities` (permission authority), axios, global `fetch`, or
 * `window.hermesDesktop`. This file deliberately respects all of that.
 */

import { EmptyState, ErrorState, icons, Loader, usePluginI18n } from '@hermes/plugin-sdk'

import type { DashboardViewModel } from './page-dashboard.view-model'
import { CapabilityBadge, PageStatusBadge } from './status-badge'
import { ConsolePanel, KpiCard, PageHeader } from './ui'

function HealthCardView({
  health,
  healthPending,
  healthError,
  authMode,
  t,
}: Pick<DashboardViewModel, 'health' | 'healthPending' | 'healthError' | 'authMode'> & {
  t: (key: string) => string
}) {
  if (healthPending) {
    return (
      <div className="min-h-28" data-testid="console-health">
        <Loader />
      </div>
    )
  }

  if (healthError) {
    return (
      <div data-testid="console-health">
        <ErrorState description={healthError} title="health" />
      </div>
    )
  }

  return (
    <div data-testid="console-health">
      <KpiCard accent="brand" icon={icons.Activity} label="Hermes service" value={health?.ok ? 'ok' : 'down'} />
      <span className="sr-only" data-testid="console-health-ok">
        {health?.ok ? 'ok' : 'down'}
      </span>
      <p className="mt-2 text-(--ui-text-secondary)">
        {t('session.authMode')}: <span data-ec-mono="">{authMode ?? '—'}</span>
      </p>
    </div>
  )
}

function SessionCardView({
  whoami,
  t,
}: Pick<DashboardViewModel, 'whoami'> & {
  t: (key: string) => string
}) {
  if (!whoami) {
    return null
  }

  return (
    <ConsolePanel title={t('session.principal')}>
      <dl
        className="grid grid-cols-[minmax(7rem,0.35fr)_minmax(0,1fr)] gap-x-5 gap-y-3"
        data-testid="console-session"
      >
        <dt className="text-(--ui-text-secondary)">{t('session.principal')}</dt>
        <dd className="min-w-0 truncate font-medium text-(--ui-text-primary)">{whoami.name}</dd>
        <dt className="text-(--ui-text-secondary)">{t('session.tenant')}</dt>
        <dd className="min-w-0 truncate text-(--ui-text-primary)" data-ec-mono="">
          {whoami.tenant_id ?? '—'}
        </dd>
        <dt className="text-(--ui-text-secondary)">{t('session.role')}</dt>
        <dd className="min-w-0 truncate text-(--ui-text-primary)" data-ec-mono="">
          {whoami.role}
        </dd>
      </dl>
    </ConsolePanel>
  )
}

function CapabilitiesCardView({
  capabilityEntries,
  hasNoCapabilities,
}: Pick<DashboardViewModel, 'capabilityEntries' | 'hasNoCapabilities'>) {
  if (hasNoCapabilities) {
    return null
  }

  return (
    <ConsolePanel divided title="Capabilities">
      <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-capabilities">
        {capabilityEntries.map(([key, cap]) => (
          <li className="flex min-h-10 items-center justify-between gap-3 py-2" key={key}>
            <span className="min-w-0 truncate text-(--ui-text-primary)" data-ec-mono="">
              {key}
            </span>
            <CapabilityBadge status={cap.status} />
          </li>
        ))}
      </ul>
    </ConsolePanel>
  )
}

function MetricsCardView({
  metrics,
  metricsPending,
  metricsError,
  activeAlerts,
}: Pick<DashboardViewModel, 'metrics' | 'metricsPending' | 'metricsError' | 'activeAlerts'>) {
  if (metricsPending) {
    return <KpiCard accent="takeover" icon={icons.Bell} label="Active alerts · 24h" loading />
  }

  if (metricsError) {
    return <ErrorState description={metricsError} title="metrics" />
  }

  return (
    <div className="flex flex-col gap-3">
      <KpiCard accent="takeover" icon={icons.Bell} label="Active alerts · 24h" value={activeAlerts.length} />
      <ConsolePanel divided title="Active alerts">
        {activeAlerts.length === 0 ? (
          <EmptyState className="min-h-20" title="no active alerts" />
        ) : (
          <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-alerts">
            {activeAlerts.map((alert, index) => (
              <li className="flex items-start justify-between gap-4 py-3" key={alert.code ?? index}>
                <div className="min-w-0">
                  <div className="font-medium text-(--ui-text-primary)">{alert.message ?? alert.code ?? 'alert'}</div>
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
  )
}

function CapabilityKpiView({ liveCapabilityCount }: Pick<DashboardViewModel, 'liveCapabilityCount'>) {
  return (
    <KpiCard
      accent="knowledge"
      icon={icons.Layers3}
      label="Live capabilities"
      value={liveCapabilityCount}
    />
  )
}

export function DashboardView({ vm }: { vm: DashboardViewModel }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status={vm.pageStatus}
      data-testid="console-page-dashboard"
    >
      <PageHeader
        purpose={vm.workspace.purpose}
        status={<PageStatusBadge status={vm.pageStatus} />}
        title={vm.workspace.title}
      />

      <div className="grid gap-(--ec-gutter) md:grid-cols-2 xl:grid-cols-3">
        <HealthCardView
          authMode={vm.authMode}
          health={vm.health}
          healthError={vm.healthError}
          healthPending={vm.healthPending}
          t={t}
        />
        <MetricsCardView
          activeAlerts={vm.activeAlerts}
          metrics={vm.metrics}
          metricsError={vm.metricsError}
          metricsPending={vm.metricsPending}
        />
        <CapabilityKpiView liveCapabilityCount={vm.liveCapabilityCount} />
      </div>

      <div className="mt-(--ec-gutter) grid items-start gap-(--ec-gutter) xl:grid-cols-2">
        <SessionCardView t={t} whoami={vm.whoami} />
        <CapabilitiesCardView
          capabilityEntries={vm.capabilityEntries}
          hasNoCapabilities={vm.hasNoCapabilities}
        />
      </div>
    </div>
  )
}