/**
 * Conversations page (PARTIAL) — real `/api/delivery-outbox` (read-only:
 * outbound / failures / unknown_delivery). Inbound / held / recovery have no
 * server route yet and are called out, not faked.
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'

interface OutboxRow {
  attempts: number
  channel: string
  intent_id: string
  kind: string
  last_error_class: null | string
  next_retry_at: null | number
  state: string
  updated_at: number
}

interface OutboxMetrics {
  cancelled_total: number
  delivered_total: number
  outbox_delivering: number
  outbox_pending: number
  outbox_retrying: number
  permanent_failure_total: number
  unknown_delivery_total: number
}

interface DeliveryOutboxResp {
  available: boolean
  metrics: OutboxMetrics
  outbox: OutboxRow[]
}

const STATE_TONE: Record<string, StatusTone> = {
  cancelled: 'muted',
  delivering: 'good',
  failed: 'bad',
  pending: 'muted',
  retrying: 'warn',
  sent: 'good',
  unknown_delivery: 'warn'
}

const METRIC_LABELS: Array<[keyof OutboxMetrics, string]> = [
  ['outbox_pending', 'pending'],
  ['outbox_delivering', 'delivering'],
  ['outbox_retrying', 'retrying'],
  ['delivered_total', 'delivered'],
  ['permanent_failure_total', 'failed'],
  ['unknown_delivery_total', 'unknown'],
  ['cancelled_total', 'cancelled']
]

export function ConversationsPage() {
  const query = useConsoleQuery<DeliveryOutboxResp>(['enterprise-console', 'delivery-outbox'], '/api/delivery-outbox')

  return (
    <div className="flex flex-col gap-3" data-page-status="partial" data-testid="console-page-conversations">
      <div className="text-xs text-muted-foreground">Inbound / held / recovery have no server API yet.</div>
      <QueryBody emptyText="no outbound deliveries" isEmpty={data => !data.available} query={query}>
        {data => (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-4 gap-2" data-testid="console-outbox-metrics">
              {METRIC_LABELS.map(([key, label]) => (
                <div className="rounded-md border border-border p-2 text-center" key={key}>
                  <div className="text-sm tabular-nums">{data.metrics?.[key] ?? 0}</div>
                  <div className="text-[0.625rem] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            <ConsoleRows testId="console-outbox">
              {data.outbox.map(row => (
                <li
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                  key={row.intent_id}
                >
                  <div className="min-w-0">
                    <div className="truncate">
                      {row.channel} · {row.kind}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.last_error_class ?? 'ok'} · {row.attempts} · {fmtEpoch(row.updated_at)}
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs">
                    <StatusDot tone={STATE_TONE[row.state] ?? 'muted'} />
                    {row.state}
                  </span>
                </li>
              ))}
            </ConsoleRows>
          </div>
        )}
      </QueryBody>
    </div>
  )
}
