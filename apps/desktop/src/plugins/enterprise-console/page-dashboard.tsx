/**
 * Dashboard / Service Health — the first fully-live page. Reads real server
 * authority through the transport: `/api/health` (liveness + auth posture) and
 * `/api/metrics` (event counters + surfaced alerts), plus the session's own
 * whoami. Every capability is shown with the server's maturity verdict, so
 * nothing DEV reads as live. The page never sees a token — it calls the
 * transport, which owns the credential.
 */

import { EmptyState, ErrorState, Loader, usePluginI18n, useQuery, useValue } from '@hermes/plugin-sdk'

import { $whoami } from './session'
import { CapabilityBadge } from './status-badge'
import { useTransport } from './transport'
import type { Health, Metrics } from './types'

function HealthCard() {
  const t = usePluginI18n('enterprise-console')
  const transport = useTransport()

  const { data, error, isPending } = useQuery({
    queryFn: () => transport.get<Health>('/api/health'),
    queryKey: ['enterprise-console', 'health'],
    refetchInterval: 30_000
  })

  if (isPending) {
    return <Loader />
  }

  if (error) {
    return <ErrorState description={String((error as Error).message)} title="health" />
  }

  return (
    <div className="rounded-lg border border-border p-3" data-testid="console-health">
      <div className="text-xs font-medium text-muted-foreground">health</div>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <span data-testid="console-health-ok">{data.ok ? 'ok' : 'down'}</span>
        <span className="text-muted-foreground">
          {t('session.authMode')}: {data.auth_mode}
        </span>
      </div>
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
    <div className="rounded-lg border border-border p-3" data-testid="console-session">
      <div className="grid grid-cols-2 gap-1 text-sm">
        <span className="text-muted-foreground">{t('session.principal')}</span>
        <span>{who.name}</span>
        <span className="text-muted-foreground">{t('session.tenant')}</span>
        <span>{who.tenant_id ?? '—'}</span>
        <span className="text-muted-foreground">{t('session.role')}</span>
        <span>{who.role}</span>
      </div>
    </div>
  )
}

function CapabilitiesCard() {
  const who = useValue($whoami)
  const caps = who ? Object.entries(who.product_capabilities) : []

  if (caps.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-border p-3" data-testid="console-capabilities">
      <div className="mb-2 text-xs font-medium text-muted-foreground">capabilities</div>
      <ul className="flex flex-col gap-1">
        {caps.map(([key, cap]) => (
          <li className="flex items-center justify-between gap-2 text-sm" key={key}>
            <span className="truncate">{key}</span>
            <CapabilityBadge status={cap.status} />
          </li>
        ))}
      </ul>
    </div>
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
    return <Loader />
  }

  if (error) {
    return <ErrorState description={String((error as Error).message)} title="metrics" />
  }

  const alerts = data.alerts ?? []

  return (
    <div className="rounded-lg border border-border p-3" data-testid="console-metrics">
      <div className="mb-1 text-xs font-medium text-muted-foreground">alerts</div>
      {alerts.length === 0 ? (
        <EmptyState className="min-h-16" title="no active alerts" />
      ) : (
        <ul className="flex flex-col gap-1" data-testid="console-alerts">
          {alerts.map((alert, index) => (
            <li className="text-sm" key={alert.code ?? index}>
              {alert.message ?? alert.code ?? 'alert'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-3" data-page-status="ready" data-testid="console-page-dashboard">
      <SessionCard />
      <HealthCard />
      <MetricsCard />
      <CapabilitiesCard />
    </div>
  )
}
