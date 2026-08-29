/**
 * Conversations page (SC3) — Presentational View layer.
 *
 * Receives fully-derived VMs (inbound list, outbound list, attempts
 * detail) plus loading/error state from the controller and presentation
 * callbacks. No transport, no useValue, no $whoami. Reuses
 * `QueryBody` / `ConsoleRows` from `./page-kit` (per W1-B1-REMEDIATION-01
 * §P12 ESLint refinement).
 *
 * Per W1-B1-REMEDIATION-01:
 *   - §P17: rendering markup lives here, NOT in the glue. The glue is
 *     thin composition only.
 *   - §P18: attempts error semantics are preserved — the view handles
 *     pending / error / not_implemented / empty / ready via `QueryBody`.
 *   - §P20: NO extra `t('status.moduleBody')` paragraph is rendered —
 *     that paragraph was not in the pre-split page.
 *   - §P21: `ConsoleRows` is reused for inbound / outbound / attempts.
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import {
  type AttemptView,
  type ConversationsAttemptsView,
  type ConversationsInboundListView,
  type ConversationsOutboundListView,
  type ConversationsTab,
  type InboundView,
  type OutboundView,
  OUTCOME_TONE,
  STATE_TONE,
} from './page-conversations.view-model'
import {
  ConsoleRows,
  QueryBody,
} from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

interface InboundListProps {
  list: ConversationsInboundListView
  isPending: boolean
  error: unknown
}

export function InboundListView({ list, isPending, error }: InboundListProps) {
  return (
    <QueryBody
      emptyText="no inbound"
      isEmpty={(data: { inbound: InboundView[] }) => data.inbound.length === 0}
      query={{
        data: { inbound: list.rows },
        error: error ?? null,
        isPending,
      }}
    >
      {() => (
        <ConsoleRows testId="console-conv-inbound">
          {list.rows.map((row) => (
            <li
              className="flex items-center justify-between gap-4 rounded-md px-3 py-2.5 hover:bg-(--ui-fill-quaternary)"
              key={row.inboundId}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-(--ui-text-primary)">
                  {row.channel} · {row.messageType}
                </div>
                <div className="mt-0.5 text-(--ui-text-secondary)" data-ec-mono="">
                  {row.externalChatId ?? '—'} · {row.receivedTs}
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                <StatusDot tone={row.stateTone} />
                {row.state}
              </span>
            </li>
          ))}
        </ConsoleRows>
      )}
    </QueryBody>
  )
}

interface AttemptsProps {
  attempts: ConversationsAttemptsView
  isPending: boolean
  error: unknown
}

export function AttemptsView({ attempts, isPending, error }: AttemptsProps) {
  return (
    <div className="mt-2 border-l border-(--ui-stroke-tertiary) pl-3">
      <QueryBody
        emptyText="no attempts"
        isEmpty={(data: { attempts: AttemptView[] }) => data.attempts.length === 0}
        query={{
          data: { attempts: attempts.rows },
          error: error ?? null,
          isPending,
        }}
      >
        {() => (
          <ConsoleRows testId="console-conv-attempts">
            {attempts.rows.map((row) => {
              const tone: StatusTone =
                OUTCOME_TONE[row.outcomeClass] ?? STATE_TONE[row.state] ?? 'muted'

              return (
                <li className="flex items-center justify-between gap-3 py-2" key={row.attemptId}>
                  <span className="min-w-0 truncate text-(--ui-text-secondary)" data-ec-mono="">
                    #{row.attemptNumber} · {row.outcomeClass} · {row.finishedTs}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                    <StatusDot tone={tone} />
                    {row.state}
                  </span>
                </li>
              )
            })}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}

interface OutboundListProps {
  list: ConversationsOutboundListView
  isPending: boolean
  error: unknown
  selected: null | string
  onSelect: (id: string) => void
  attemptsSlot: ReactNode
}

export function OutboundListView({
  list,
  isPending,
  error,
  selected,
  onSelect,
  attemptsSlot,
}: OutboundListProps) {
  return (
    <QueryBody
      emptyText="no outbound"
      isEmpty={(data: { outbound: OutboundView[] }) => data.outbound.length === 0}
      query={{
        data: { outbound: list.rows },
        error: error ?? null,
        isPending,
      }}
    >
      {() => (
        <ConsoleRows testId="console-conv-outbound">
          {list.rows.map((row) => {
            const isSelected = row.internalMessageId === selected

            return (
              <li
                className="border-b border-(--ui-stroke-tertiary) last:border-b-0"
                key={row.internalMessageId}
              >
                <button
                  className={
                    isSelected
                      ? 'flex w-full items-center justify-between gap-4 rounded-md bg-(--ui-fill-secondary) px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                      : 'flex w-full items-center justify-between gap-4 rounded-md px-3 py-2.5 text-left outline-none hover:bg-(--ui-fill-quaternary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                  }
                  data-testid={`console-outbound-${row.internalMessageId}`}
                  onClick={() => onSelect(row.internalMessageId)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-(--ui-text-primary)">
                      {row.channel} · {row.recipientBindingId}
                    </span>
                    <span className="mt-0.5 block text-(--ui-text-secondary)" data-ec-mono="">
                      {row.createdTs}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                    <StatusDot tone={row.stateTone} />
                    {row.state}
                  </span>
                </button>
                {isSelected && attemptsSlot ? attemptsSlot : null}
              </li>
            )
          })}
        </ConsoleRows>
      )}
    </QueryBody>
  )
}

interface TabToggleProps {
  tab: ConversationsTab
  onChange: (next: ConversationsTab) => void
}

function TabToggle({ tab, onChange }: TabToggleProps) {
  return (
    <div
      aria-label="Conversation direction"
      className="inline-flex rounded-lg bg-(--ui-fill-quaternary) p-1"
      role="tablist"
    >
      {(['inbound', 'outbound'] as const).map((value) => (
        <button
          aria-selected={tab === value}
          className={
            tab === value
              ? 'rounded-md bg-(--ui-bg-card) px-3 py-1.5 font-medium text-(--ui-text-primary) shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
              : 'rounded-md px-3 py-1.5 text-(--ui-text-secondary) outline-none hover:text-(--ui-text-primary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
          }
          data-testid={`console-conv-tab-${value}`}
          key={value}
          onClick={() => onChange(value)}
          role="tab"
          type="button"
        >
          {value}
        </button>
      ))}
    </div>
  )
}

export function ConversationsView({
  tab,
  onChangeTab,
  inbound,
  inboundPending,
  inboundError,
  outbound,
  outboundPending,
  outboundError,
  selected,
  onSelect,
  attemptsSlot,
}: {
  tab: ConversationsTab
  onChangeTab: (next: ConversationsTab) => void
  inbound: ConversationsInboundListView
  inboundPending: boolean
  inboundError: unknown
  outbound: ConversationsOutboundListView
  outboundPending: boolean
  outboundError: unknown
  selected: null | string
  onSelect: (id: string) => void
  attemptsSlot: ReactNode
}) {
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
        action={<TabToggle onChange={onChangeTab} tab={tab} />}
        divided
        title={tab === 'inbound' ? 'Inbound messages' : 'Outbound messages'}
      >
        {tab === 'inbound' ? (
          <InboundListView
            error={inboundError}
            isPending={inboundPending}
            list={inbound}
          />
        ) : (
          <OutboundListView
            attemptsSlot={attemptsSlot}
            error={outboundError}
            isPending={outboundPending}
            list={outbound}
            onSelect={onSelect}
            selected={selected}
          />
        )}
      </ConsolePanel>

      <p className="mt-3 text-(--ui-text-tertiary)">
        Delivery attempts are evidence only. No retry or held-release action is exposed from this Phase-1 surface.
      </p>
    </div>
  )
}