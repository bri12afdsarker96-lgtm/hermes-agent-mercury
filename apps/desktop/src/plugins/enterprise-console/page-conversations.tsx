/**
 * Conversations page (SC3) — real `/api/conversations-inbound|outbound|attempts`
 * (permission `conversation.read`; NOT `delivery.read` — that is the delivery
 * outbox, a different authority). READ-ONLY observability: inbound + outbound
 * messages and, drilling from an outbound message, its delivery attempts. Row
 * visibility is owner-scoped for managed roles INSIDE the server model (the
 * client sends no principal/role/tenant filter and makes no authz decision).
 * Timestamps are ISO-8601 strings (fmtIso, never fmtEpoch). Only outbound rows
 * carry `internal_message_id`, so only outbound drills into attempts.
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConsoleRows, fmtIso, QueryBody, useConsoleQuery } from './page-kit'

interface InboundRow {
  channel: string
  external_chat_id: null | string
  inbound_id: string
  message_type: string
  processed_ts: null | string
  received_ts: string
  state: string
  updated_ts: string
}

interface OutboundRow {
  channel: string
  created_ts: string
  internal_message_id: string
  recipient_binding_id: string
  state: string
  updated_ts: string
}

interface AttemptRow {
  attempt_id: string
  attempt_number: number
  created_ts: string
  finished_ts: null | string
  internal_message_id: string
  outcome_class: string
  state: string
}

interface InboundResp {
  inbound: InboundRow[]
}
interface OutboundResp {
  outbound: OutboundRow[]
}
interface AttemptsResp {
  attempts: AttemptRow[]
}

const STATE_TONE: Record<string, StatusTone> = {
  failed: 'bad',
  processed: 'good',
  processing: 'warn',
  queued: 'muted',
  received: 'muted',
  rejected: 'bad',
  sending: 'warn',
  sent: 'good',
  started: 'muted',
  succeeded: 'good'
}

const OUTCOME_TONE: Record<string, StatusTone> = {
  permanent: 'bad',
  success: 'good',
  transient: 'warn'
}

function Attempts({ internalMessageId }: { internalMessageId: string }) {
  const query = useConsoleQuery<AttemptsResp>(
    ['enterprise-console', 'conv-attempts', internalMessageId],
    `/api/conversations-attempts?internal_message_id=${encodeURIComponent(internalMessageId)}`,
    0
  )

  return (
    <div className="mt-1 border-l-2 border-border pl-2">
      <QueryBody emptyText="no attempts" isEmpty={data => data.attempts.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-conv-attempts">
            {data.attempts.map(attempt => (
              <li className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs" key={attempt.attempt_id}>
                <span className="min-w-0 truncate">
                  #{attempt.attempt_number} · {attempt.outcome_class} · {fmtIso(attempt.finished_ts)}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <StatusDot tone={OUTCOME_TONE[attempt.outcome_class] ?? STATE_TONE[attempt.state] ?? 'muted'} />
                  {attempt.state}
                </span>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}

function InboundList() {
  const query = useConsoleQuery<InboundResp>(['enterprise-console', 'conv-inbound'], '/api/conversations-inbound')

  return (
    <QueryBody emptyText="no inbound" isEmpty={data => data.inbound.length === 0} query={query}>
      {data => (
        <ConsoleRows testId="console-conv-inbound">
          {data.inbound.map(row => (
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              key={row.inbound_id}
            >
              <div className="min-w-0">
                <div className="truncate">
                  {row.channel} · {row.message_type}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.external_chat_id ?? '—'} · {fmtIso(row.received_ts)}
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs">
                <StatusDot tone={STATE_TONE[row.state] ?? 'muted'} />
                {row.state}
              </span>
            </li>
          ))}
        </ConsoleRows>
      )}
    </QueryBody>
  )
}

function OutboundList() {
  const query = useConsoleQuery<OutboundResp>(['enterprise-console', 'conv-outbound'], '/api/conversations-outbound')
  const [selected, setSelected] = useState<null | string>(null)

  return (
    <QueryBody emptyText="no outbound" isEmpty={data => data.outbound.length === 0} query={query}>
      {data => (
        <ConsoleRows testId="console-conv-outbound">
          {data.outbound.map(row => (
            <li key={row.internal_message_id}>
              <button
                className={
                  row.internal_message_id === selected
                    ? 'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-accent px-2 py-1.5 text-left text-sm'
                    : 'flex w-full items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-left text-sm hover:bg-accent/50'
                }
                data-testid={`console-outbound-${row.internal_message_id}`}
                onClick={() => setSelected(id => (id === row.internal_message_id ? null : row.internal_message_id))}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {row.channel} · {row.recipient_binding_id}
                  </span>
                  <span className="block text-xs text-muted-foreground">{fmtIso(row.created_ts)}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs">
                  <StatusDot tone={STATE_TONE[row.state] ?? 'muted'} />
                  {row.state}
                </span>
              </button>
              {row.internal_message_id === selected ? <Attempts internalMessageId={row.internal_message_id} /> : null}
            </li>
          ))}
        </ConsoleRows>
      )}
    </QueryBody>
  )
}

export function ConversationsPage() {
  const [tab, setTab] = useState<'inbound' | 'outbound'>('inbound')

  return (
    <div className="flex flex-col gap-2" data-page-status="ready" data-testid="console-page-conversations">
      <div className="flex gap-1">
        {(['inbound', 'outbound'] as const).map(value => (
          <button
            className={
              tab === value
                ? 'rounded-md bg-accent px-2 py-1 text-sm'
                : 'rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50'
            }
            data-testid={`console-conv-tab-${value}`}
            key={value}
            onClick={() => setTab(value)}
            type="button"
          >
            {value}
          </button>
        ))}
      </div>
      {tab === 'inbound' ? <InboundList /> : <OutboundList />}
    </div>
  )
}
