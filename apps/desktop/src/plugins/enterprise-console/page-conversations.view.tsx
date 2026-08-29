/**
 * Conversations page — Presentational view.
 *
 * Receives a `ConversationsViewModel` + click handlers. No transport, no
 * query hooks, no session atoms.
 *
 * Selection state is owned by the GLUE (`page-conversations.tsx`) — the
 * view is pure and emits onSelect/onTab callbacks. Wave 1 / Step 6 of
 * W5-B0 contract freeze.
 *
 * The eslint config at `apps/desktop/eslint.config.mjs` enforces
 * VIEW_FORBIDDEN_IMPORTS on this file via `no-restricted-imports`.
 */

import { StatusDot } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { fmtIso } from './page-kit'
import type { ConversationsViewModel } from './page-conversations.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, ConsoleRows, PageHeader } from './ui'

export interface ConversationsViewProps {
  vm: ConversationsViewModel
  onSelectOutbound: (internalMessageId: string) => void
  onSwitchTab: (tab: 'inbound' | 'outbound') => void
}

function TabButton({
  active,
  label,
  onClick,
  testId,
}: {
  active: boolean
  label: string
  onClick: () => void
  testId: string
}): ReactNode {
  return (
    <button
      aria-selected={active}
      className={
        active
          ? 'rounded-md bg-(--ui-bg-card) px-3 py-1.5 font-medium text-(--ui-text-primary) shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
          : 'rounded-md px-3 py-1.5 text-(--ui-text-secondary) outline-none hover:text-(--ui-text-primary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
      }
      data-testid={testId}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
    </button>
  )
}

export function ConversationsView({ vm, onSelectOutbound, onSwitchTab }: ConversationsViewProps) {
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
          <div
            aria-label="Conversation direction"
            className="inline-flex rounded-lg bg-(--ui-fill-quaternary) p-1"
            role="tablist"
          >
            <TabButton
              active={vm.activeTab === 'inbound'}
              label="inbound"
              onClick={() => onSwitchTab('inbound')}
              testId="console-conv-tab-inbound"
            />
            <TabButton
              active={vm.activeTab === 'outbound'}
              label="outbound"
              onClick={() => onSwitchTab('outbound')}
              testId="console-conv-tab-outbound"
            />
          </div>
        }
        divided
        title={vm.activeTab === 'inbound' ? 'Inbound messages' : 'Outbound messages'}
      >
        {vm.activeTab === 'inbound' ? (
          vm.inboundEmpty ? (
            <p className="text-(--ui-text-tertiary)" data-testid="console-conv-inbound-empty">
              no inbound
            </p>
          ) : (
            <ConsoleRows testId="console-conv-inbound">
              {vm.inbound.map(row => (
                <li
                  className="flex items-center justify-between gap-4 rounded-md px-3 py-2.5 hover:bg-(--ui-fill-quaternary)"
                  key={row.inboundId}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-(--ui-text-primary)">
                      {row.channel} · {row.messageType}
                    </div>
                    <div className="mt-0.5 text-(--ui-text-secondary)" data-ec-mono="">
                      {row.externalChatId ?? '—'} · {fmtIso(row.receivedTs)}
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                    <StatusDot tone={row.tone} />
                    {row.state}
                  </span>
                </li>
              ))}
            </ConsoleRows>
          )
        ) : vm.outboundEmpty ? (
          <p className="text-(--ui-text-tertiary)" data-testid="console-conv-outbound-empty">
            no outbound
          </p>
        ) : (
          <ConsoleRows testId="console-conv-outbound">
            {vm.outbound.map(row => (
              <li
                className="border-b border-(--ui-stroke-tertiary) last:border-b-0"
                key={row.internalMessageId}
              >
                <button
                  className={
                    row.isSelected
                      ? 'flex w-full items-center justify-between gap-4 rounded-md bg-(--ui-fill-secondary) px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                      : 'flex w-full items-center justify-between gap-4 rounded-md px-3 py-2.5 text-left outline-none hover:bg-(--ui-fill-quaternary) focus-visible:ring-2 focus-visible:ring-(--ui-accent)'
                  }
                  data-testid={`console-outbound-${row.internalMessageId}`}
                  onClick={() => onSelectOutbound(row.internalMessageId)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-(--ui-text-primary)">
                      {row.channel} · {row.recipientBindingId}
                    </span>
                    <span className="mt-0.5 block text-(--ui-text-secondary)" data-ec-mono="">
                      {fmtIso(row.createdTs)}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                    <StatusDot tone={row.tone} />
                    {row.state}
                  </span>
                </button>
                {row.isSelected && vm.attemptsVisible ? (
                  <div className="mt-2 border-l border-(--ui-stroke-tertiary) pl-3" data-testid="console-conv-attempts">
                    {vm.attemptsEmpty ? (
                      <p className="text-(--ui-text-tertiary)">no attempts</p>
                    ) : (
                      <ConsoleRows testId="console-conv-attempts-list">
                        {vm.attempts.map(attempt => (
                          <li
                            className="flex items-center justify-between gap-3 py-2"
                            key={attempt.attemptId}
                          >
                            <span className="min-w-0 truncate text-(--ui-text-secondary)" data-ec-mono="">
                              #{attempt.attemptNumber} · {attempt.outcomeClass} · {fmtIso(attempt.finishedTs)}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
                              <StatusDot tone={attempt.tone} />
                              {attempt.state}
                            </span>
                          </li>
                        ))}
                      </ConsoleRows>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ConsoleRows>
        )}
      </ConsolePanel>

      <p className="mt-3 text-(--ui-text-tertiary)">
        Delivery attempts are evidence only. No retry or held-release action is exposed from this Phase-1 surface.
      </p>
    </div>
  )
}