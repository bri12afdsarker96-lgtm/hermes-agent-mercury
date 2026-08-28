/**
 * Conversations page (SC3) — authoritative read-only observability over
 * `/api/conversations-inbound|outbound|attempts`. This presentation never adds
 * retry/release authority: unknown delivery must not be blindly resent.
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConsoleRows, fmtIso, QueryBody, useConsoleQuery } from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

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
    <div className="mt-2 border-l border-(--ui-stroke-tertiary) pl-3">
      <QueryBody emptyText="no attempts" isEmpty={data => data.attempts.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-conv-attempts">
            {data.attempts.map(attempt => (
              <li className="flex items-center justify-between gap-3 py-2" key={attempt.attempt_id}>
                <span className="min-w-0 truncate text-(--ui-text-secondary)" data-ec-mono="">
                  #{attempt.attempt_number} · {attempt.outcome_class} · {fmtIso(attempt.finished_ts)}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
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
            <li className="flex items-center justify-between gap-4 rounded-md px-3 py-2.5 hover:bg-(--ui-fill-quaternary)" key={row.inbound_id}>
              <div className="min-w-0">
                <div className="truncate font-medium text-(--ui-text-primary)">
                  {row.channel} · {row.message_type}
                </div>
                <div className="mt-0.5 text-(--ui-text-secondary)" data-ec-mono="">
                  {row.external_chat_id ?? '—'} · {fmtIso(row.received_ts)}
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
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
            <li className="border-b border-(--ui-stroke-tertiary) last:border-b-0" key={row.internal_message_id}>
              <button
                className={
                  row.internal_message_id === selected
                    ? 'flex w-full items-center justify-between gap-4 rounded-md bg-(--ui-fill-secondary) px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                    : 'flex w-full items-center justify-between gap-4 rounded-md px-3 py-2.5 text-left outline-none hover:bg-(--ui-fill-quaternary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                }
                data-testid={`console-outbound-${row.internal_message_id}`}
                onClick={() => setSelected(id => (id === row.internal_message_id ? null : row.internal_message_id))}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-(--ui-text-primary)">
                    {row.channel} · {row.recipient_binding_id}
                  </span>
                  <span className="mt-0.5 block text-(--ui-text-secondary)" data-ec-mono="">
                    {fmtIso(row.created_ts)}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
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
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-conversations"
    >
      <PageHeader
        purpose="Inspect tenant-scoped inbound and outbound message facts and delivery attempts. Read-only by design."
        status={<PageStatusBadge status="ready" />}
        title="WeCom conversations"
      />

      <ConsolePanel
        action={
          <div aria-label="Conversation direction" className="inline-flex rounded-lg bg-(--ui-fill-quaternary) p-1" role="tablist">
            {(['inbound', 'outbound'] as const).map(value => (
              <button
                aria-selected={tab === value}
                className={
                  tab === value
                    ? 'rounded-md bg-(--ui-bg-card) px-3 py-1.5 font-medium text-(--ui-text-primary) shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                    : 'rounded-md px-3 py-1.5 text-(--ui-text-secondary) outline-none hover:text-(--ui-text-primary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                }
                data-testid={`console-conv-tab-${value}`}
                key={value}
                onClick={() => setTab(value)}
                role="tab"
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
        }
        divided
        title={tab === 'inbound' ? 'Inbound messages' : 'Outbound messages'}
      >
        {tab === 'inbound' ? <InboundList /> : <OutboundList />}
      </ConsolePanel>

      <p className="mt-3 text-(--ui-text-tertiary)">
        Delivery attempts are evidence only. No retry or held-release action is exposed from this Phase-1 surface.
      </p>
    </div>
  )
}
