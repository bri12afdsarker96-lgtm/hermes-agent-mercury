/**
 * Conversations page (SC3) — Presentational View layer.
 *
 * Receives the resolved lists + tab + selection callbacks + an
 * `attemptsSlot` (a ReactNode) that the glue mounts for the selected
 * outbound row. The view does NOT call the controller hook directly;
 * the glue slots the per-row attempts block via the `attemptsSlot`
 * prop so the view stays free of transport.
 *
 * No useValue, no $whoami, no transport. The ESLint W1-A boundary
 * rule naturally constrains any `*.view.tsx` file.
 *
 * Per Phase-1, this view deliberately exposes NO mutation control
 * (no resend / replay / retry buttons). Delivery attempts are
 * evidence-only. unknown_delivery stays evidence-only.
 */

import {
  EmptyState,
  ErrorState,
  Loader,
  StatusDot,
  usePluginI18n,
} from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import {
  type ConversationsInboundListView,
  type ConversationsOutboundListView,
  type ConversationsTab,
  type InboundView,
  type OutboundView,
} from './page-conversations.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

interface InboundListViewProps {
  list: ConversationsInboundListView
  listPending: boolean
  listError: unknown
}

function InboundListView({ list, listPending, listError }: InboundListViewProps) {
  const t = usePluginI18n('enterprise-console')

  if (listPending) {
    return <Loader />
  }

  const errorText = listError instanceof Error ? listError.message : null

  if (errorText) {
    return <ErrorState description={errorText} title={t('status.error')} />
  }

  if (list.isEmpty) {
    return <EmptyState title="no inbound" />
  }

  return (
    <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-conv-inbound">
      {list.rows.map((row: InboundView) => (
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
    </ul>
  )
}

interface OutboundListViewProps {
  list: ConversationsOutboundListView
  listPending: boolean
  listError: unknown
  selected: null | string
  onSelect: (id: string) => void
  attemptsSlot: ReactNode
}

function OutboundListView({
  list,
  listPending,
  listError,
  selected,
  onSelect,
  attemptsSlot,
}: OutboundListViewProps) {
  const t = usePluginI18n('enterprise-console')

  if (listPending) {
    return <Loader />
  }

  const errorText = listError instanceof Error ? listError.message : null

  if (errorText) {
    return <ErrorState description={errorText} title={t('status.error')} />
  }

  if (list.isEmpty) {
    return <EmptyState title="no outbound" />
  }

  return (
    <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-conv-outbound">
      {list.rows.map((row: OutboundView) => {
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
    </ul>
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
            list={inbound}
            listError={inboundError}
            listPending={inboundPending}
          />
        ) : (
          <OutboundListView
            attemptsSlot={attemptsSlot}
            list={outbound}
            listError={outboundError}
            listPending={outboundPending}
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