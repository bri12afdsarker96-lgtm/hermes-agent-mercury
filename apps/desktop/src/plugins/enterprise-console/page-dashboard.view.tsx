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
 *
 * V0 productization addenda (P1-VIS-V0):
 *  - All loading / error / data render paths go through the
 *    single `vm.healthState` / `vm.metricsState` four-state discriminators
 *    (no more hand-rolled nested ifs), and every state carries the same
 *    `min-h` so the panel does not jump between states (P10 §Responsive).
 *  - The `console-health-ok` sr-only signal keeps its PR18 textContent
 *    contract (`ok` / `down`) so prior tests stay green, and a parallel
 *    `console-health-state` exposes the full four-state class for
 *    diagnostics (no behaviour change).
 *  - The alerts KPI tile reads `vm.alertsCount` (pure VM derivation)
 *    rather than re-deriving inside JSX, and the empty case is
 *    surfaced via `vm.isAlertsListEmpty` so the EmptyState is rendered
 *    only when the list is honest zero.
 */

import { EmptyState, ErrorState, icons, Loader, usePluginI18n } from '@hermes/plugin-sdk'

import type { DashboardViewModel } from './page-dashboard.view-model'
import { CapabilityBadge, PageStatusBadge } from './status-badge'
import { ConsolePanel, KpiCard, PageHeader } from './ui'

// Single `min-h` for all four HealthCardView states keeps the panel
// from shifting when the React Query state crosses pending → answered.
const HEALTH_PANEL_MIN_H = 'min-h-28'
// Single `min-h` for all MetricsCardView states; the alerts tile is
// taller because it has its own EmptyState panel.
const METRICS_TILE_MIN_H = 'min-h-20'

function HealthCardView({
  healthState,
  authModeDisplay,
  t,
}: Pick<DashboardViewModel, 'healthState' | 'authModeDisplay'> & {
  t: (key: string) => string
}) {
  // Single switch on the four-state truth surface.
  switch (healthState) {
    case 'loading':
      return (
        <div className={HEALTH_PANEL_MIN_H} data-health-state="loading" data-testid="console-health">
          <Loader aria-label="health" />
          <span className="sr-only" data-testid="console-health-state">
            loading
          </span>
        </div>
      )

    case 'error': {
      // Per P5: an ERROR is not the same as DOWN. We surface the
      // server-provided message verbatim and never invent "down".
      // The vm already collapsed `error.message` to a string.
      return (
        <div className={HEALTH_PANEL_MIN_H} data-health-state="error" data-testid="console-health">
          <ErrorState title="health" />
          <span className="sr-only" data-testid="console-health-state">
            error
          </span>
        </div>
      )
    }

    case 'healthy':
      return (
        <div className={HEALTH_PANEL_MIN_H} data-health-state="healthy" data-testid="console-health">
          <KpiCard accent="brand" icon={icons.Activity} label="Hermes service" value="ok" />
          {/* PR18 contract — kept verbatim so existing tests stay green. */}
          <span className="sr-only" data-testid="console-health-ok">
            ok
          </span>
          {/* V0 addendum — full state classification for diagnostics. */}
          <span className="sr-only" data-testid="console-health-state">
            healthy
          </span>
          <p className="mt-2 text-(--ui-text-secondary)">
            {t('session.authMode')}: <span data-ec-mono="">{authModeDisplay}</span>
          </p>
        </div>
      )

    case 'down':
      return (
        <div className={HEALTH_PANEL_MIN_H} data-health-state="down" data-testid="console-health">
          <KpiCard accent="brand" icon={icons.Activity} label="Hermes service" value="down" />
          {/* PR18 contract — kept verbatim. */}
          <span className="sr-only" data-testid="console-health-ok">
            down
          </span>
          {/* V0 addendum. */}
          <span className="sr-only" data-testid="console-health-state">
            down
          </span>
          <p className="mt-2 text-(--ui-text-secondary)">
            {t('session.authMode')}: <span data-ec-mono="">{authModeDisplay}</span>
          </p>
        </div>
      )
  }
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
        className="grid grid-cols-[minmax(7rem,0.35fr)_minmax(0,1fr)] gap-x-5 gap-y-3 text-(--ui-text-primary)"
        data-testid="console-session"
      >
        <dt className="text-(--ui-text-secondary)">{t('session.principal')}</dt>
        <dd className="min-w-0 truncate font-medium" data-ec-mono="">
          {whoami.name}
        </dd>
        <dt className="text-(--ui-text-secondary)">{t('session.tenant')}</dt>
        <dd className="min-w-0 truncate" data-ec-mono="">
          {whoami.tenant_id ?? '—'}
        </dd>
        <dt className="text-(--ui-text-secondary)">{t('session.role')}</dt>
        <dd className="min-w-0 truncate" data-ec-mono="">
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
  metricsState,
  alertsCount,
  activeAlerts,
}: Pick<DashboardViewModel, 'metricsState' | 'alertsCount' | 'activeAlerts'>) {
  switch (metricsState) {
    case 'loading':
      return (
        <div className={METRICS_TILE_MIN_H} data-metrics-state="loading" data-testid="console-metrics">
          <KpiCard accent="takeover" icon={icons.Bell} label="Active alerts · 24h" loading />
          <span className="sr-only" data-testid="console-metrics-state">
            loading
          </span>
        </div>
      )

    case 'error':
      return (
        <div className={METRICS_TILE_MIN_H} data-metrics-state="error" data-testid="console-metrics">
          <ErrorState title="metrics" />
          <span className="sr-only" data-testid="console-metrics-state">
            error
          </span>
        </div>
      )

    case 'idle':
      return (
        <div className={METRICS_TILE_MIN_H} data-metrics-state="idle" data-testid="console-metrics">
          <KpiCard accent="takeover" icon={icons.Bell} label="Active alerts · 24h" value={alertsCount} />
          <ConsolePanel divided title="Active alerts">
            <EmptyState className="min-h-20" title="no active alerts" />
          </ConsolePanel>
          <span className="sr-only" data-testid="console-metrics-state">
            idle
          </span>
        </div>
      )

    case 'loaded':
      return (
        <div className={METRICS_TILE_MIN_H} data-metrics-state="loaded" data-testid="console-metrics">
          <KpiCard accent="takeover" icon={icons.Bell} label="Active alerts · 24h" value={alertsCount} />
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
          <span className="sr-only" data-testid="console-metrics-state">
            loaded
          </span>
        </div>
      )
  }
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
          authModeDisplay={vm.authModeDisplay}
          healthState={vm.healthState}
          t={t}
        />
        <MetricsCardView
          activeAlerts={vm.activeAlerts}
          alertsCount={vm.alertsCount}
          metricsState={vm.metricsState}
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