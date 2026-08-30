/**
 * Handoff page — Presentational View layer.
 *
 * Receives fully-derived VMs + action slots from the glue. NO
 * transport, NO useQueryClient, NO session atom, NO permission
 * authority, NO `./actions` import.
 *
 * Per W1-C §P24:
 *   - View MUST be a dependency leaf.
 *   - Visible copy, className, layout hierarchy, button labels,
 *     dialog titles, placeholder text, status text, section order
 *     must match pre-split exact behavior.
 *
 * Per W1-C §P19: the view is presentation-eligibility-only.
 * Server rows decide action visibility (the action slot is
 * invoked from the glue, but it must be passed as a prop).
 */

import { StatusDot } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import type { HandoffRowView } from './page-handoff.view-model'
import { ConsoleRows, QueryBody } from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

// ---------------------------------------------------------------------------
// Action slot props
// ---------------------------------------------------------------------------

export interface HandoffRowActionsSlotProps {
  msgId: string
}

// ---------------------------------------------------------------------------
// Top-level View
// ---------------------------------------------------------------------------

export interface HandoffsViewProps {
  handoffs: HandoffRowView[]
  handoffsIsPending: boolean
  handoffsError: unknown
  handoffRowActionsSlot: (props: HandoffRowActionsSlotProps) => ReactNode
}

export function HandoffsView({
  handoffs,
  handoffsIsPending,
  handoffsError,
  handoffRowActionsSlot,
}: HandoffsViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-handoff"
    >
      <PageHeader
        purpose="Claim, reply and requeue human handoffs through authoritative inbox workflows."
        status={<PageStatusBadge status="ready" />}
        title="Human handoff"
      />

      <ConsolePanel divided title="Handoff queue">
        <QueryBody
          emptyText="no handoffs"
          isEmpty={(data: { available: boolean; handoffs: unknown[] }) =>
            !data.available || data.handoffs.length === 0
          }
          query={{
            data: { available: true, handoffs },
            error: handoffsError,
            isPending: handoffsIsPending,
          }}
        >
          {() => (
            <ConsoleRows testId="console-handoffs">
              {handoffs.map((handoff) => (
                <li
                  className="flex min-h-16 items-center justify-between gap-4 border-b border-(--ui-stroke-tertiary) py-3 last:border-b-0"
                  data-testid={`console-handoff-row-${handoff.msgId}`}
                  key={handoff.msgId}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-(--ui-text-primary)">
                      {handoff.text}
                    </div>
                    <div className="mt-0.5 text-(--ui-text-tertiary)">
                      {handoff.agentDisplay}
                      {handoff.statusDisplay}
                      {' · '}
                      <span data-ec-mono="">{handoff.threadId}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-(--ui-text-secondary)">
                    {handoff.ageSeconds != null ? (
                      <span
                        className="inline-flex items-center gap-1"
                        data-ec-mono=""
                      >
                        <StatusDot tone={handoff.ageTone} />
                        {handoff.ageSeconds}s
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <StatusDot tone={handoff.stateTone} />
                      {handoff.state}
                    </span>
                    {handoffRowActionsSlot({ msgId: handoff.msgId })}
                  </div>
                </li>
              ))}
            </ConsoleRows>
          )}
        </QueryBody>
      </ConsolePanel>
    </div>
  )
}