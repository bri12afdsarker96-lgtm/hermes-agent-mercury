/**
 * Dashboard / Service Health — real server authority composed into the frozen
 * Enterprise Desktop presentation layer. Queries, permissions and capability
 * truth remain B-owned; this file only maps those answers into approved UI
 * primitives. No KPI is fabricated when the server has no corresponding fact.
 */

import { EmptyState, ErrorState, icons, Loader, usePluginI18n, useQuery, useValue } from '@hermes/plugin-sdk'

import { $whoami } from './session'
import { CapabilityBadge, PageStatusBadge } from './status-badge'
import { useTransport } from './transport'
import type { Health, Metrics, Whoami } from './types'
import { ConsolePanel, KpiCard, PageHeader } from './ui'

function HealthCard() {
  const t = usePluginI18n('enterprise-console')
  const transport = useTransport()

  const { data, error, isPending } = useQuery({
    queryFn: () => transport.get<Health>('/api/health'),
    queryKey: ['enterprise-console', 'health'],
    refetchInterval: 30_000
  })

  if (isPending) {
    return (
      <div className="min-h-28" data-testid="console-health">
        <Loader />
      </div>
    )
  }

  if (error) {
    return (
      <div data-testid="console-health">
        <ErrorState description={String((error as Error).message)} title="health" />
      </div>
    )
  }

  return (
    <div data-testid="console-health">
      <KpiCard accent="brand" icon={icons.Activity} label="Hermes service" value={data.ok ? 'ok' : 'down'} />
      <span className="sr-only" data-testid="console-health-ok">
        {data.ok ? 'ok' : 'down'}
      </span>
      <p className="mt-2 text-(--ui-text-secondary)">
        {t('session.authMode')}: <span data-ec-mono="">{data.auth_mode}</span>
      </p>
    </div>
  )
}

function SessionCard() {
  const t = usePluginI18n('enterprise-console')
  const who = useValue($whoami)

  if (!who) {
    return null
  }

  return (
    <ConsolePanel title={t('session.principal')}>
      <dl className="grid grid-cols-[minmax(7rem,0.35fr)_minmax(0,1fr)] gap-x-5 gap-y-3" data-testid="console-session">
        <dt className="text-(--ui-text-secondary)">{t('session.principal')}</dt>
        <dd className="min-w-0 truncate font-medium text-(--ui-text-primary)">{who.name}</dd>
        <dt className="text-(--ui-text-secondary)">{t('session.tenant')}</dt>
        <dd className="min-w-0 truncate text-(--ui-text-primary)" data-ec-mono="">
          {who.tenant_id ?? '—'}
        </dd>
        <dt className="text-(--ui-text-secondary)">{t('session.role')}</dt>
        <dd className="min-w-0 truncate text-(--ui-text-primary)" data-ec-mono="">
          {who.role}
        </dd>
      </dl>
    </ConsolePanel>
  )
}

function CapabilitiesCard() {
  const who = useValue($whoami)
  const caps = who ? Object.entries(who.product_capabilities) : []

  if (caps.length === 0) {
    return null
  }

  return (
    <ConsolePanel divided title="Capabilities">
      <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-capabilities">
        {caps.map(([key, cap]) => (
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

function MetricsCard() {
  const transport = useTransport()

  const { data, error, isPending } = useQuery({
    queryFn: () => transport.get<Metrics>('/api/metrics?window=24h'),
    queryKey: ['enterprise-console', 'metrics', '24h'],
    refetchInterval: 60_000
  })

  if (isPending) {
    return <KpiCard accent="takeover" icon={icons.Bell} label="Active alerts · 24h" loading />
  }

  if (error) {
    return <ErrorState description={String((error as Error).message)} title="metrics" />
  }

  const alerts = data.alerts ?? []

  return (
    <div className="flex flex-col gap-3">
      <KpiCard accent="takeover" icon={icons.Bell} label="Active alerts · 24h" value={alerts.length} />
      <ConsolePanel divided title="Active alerts">
        {alerts.length === 0 ? (
          <EmptyState className="min-h-20" title="no active alerts" />
        ) : (
          <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-alerts">
            {alerts.map((alert, index) => (
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

function CapabilityKpi() {
  const who = useValue($whoami)
  const caps = who ? Object.values(who.product_capabilities) : []
  const live = caps.filter(cap => cap.status === 'LIVE' && cap.enabled).length

  return <KpiCard accent="knowledge" icon={icons.Layers3} label="Live capabilities" value={live} />
}

interface WorkspaceCopy {
  purpose: string
  title: string
}

function workspaceCopy(who: Whoami | null): WorkspaceCopy {
  switch (who?.role) {
    case 'operator':
      return {
        purpose: 'Your authenticated operational workspace, current service health and capability truth.',
        title: 'Operator Home'
      }
    case 'supervisor':
      return {
        purpose: 'Supervisory workspace for current service health, scoped operations and capability truth.',
        title: 'Supervisor Workspace'
      }
    case 'tenant_admin':
    case 'super_admin':
      return {
        purpose: 'Tenant administration overview for service health, authenticated scope and capability truth.',
        title: 'Tenant Admin Overview'
      }
    default:
      return {
        purpose: 'Server health, authenticated workspace identity and current capability truth.',
        title: 'Workspace'
      }
  }
}

export function DashboardPage() {
  const who = useValue($whoami)
  const copy = workspaceCopy(who)

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-dashboard"
    >
      <PageHeader purpose={copy.purpose} status={<PageStatusBadge status="ready" />} title={copy.title} />

      <div className="grid gap-(--ec-gutter) md:grid-cols-2 xl:grid-cols-3">
        <HealthCard />
        <MetricsCard />
        <CapabilityKpi />
      </div>

      <div className="mt-(--ec-gutter) grid items-start gap-(--ec-gutter) xl:grid-cols-2">
        <SessionCard />
        <CapabilitiesCard />
      </div>
    </div>
  )
}
