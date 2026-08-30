/**
 * Handoff page — Presentational View layer.
 *
 * Per W1-C-REMEDIATION-01 §P5 + §P9:
 *   - Available flag is propagated from the SERVER (glue),
 *     never fabricated as `true` here.
 *   - Action slot receives three independent per-row eligibility
 *     flags (canClaim / canReply / canRequeue) derived by the VM
 *     from server row facts — the view does NOT recompute.
 *   - View is a dependency leaf (only presentational imports).
 *   - No client ownership inference; no else-if mutual exclusivity
 *     at the view layer; each action is independently composed by
 *     the glue based on its own eligibility flag.
 */

import { StatusDot } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import type { HandoffRowView } from './page-handoff.view-model'
import { ConsoleRows, QueryBody } from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

// ---------------------------------------------------------------------------
// Action slot props (per §P9 — three INDEPENDENT flags)
// ---------------------------------------------------------------------------

export interface HandoffRowActionsSlotProps {
  msgId: string
  canClaim: boolean
  canReply: boolean
  canRequeue: boolean
}

// ---------------------------------------------------------------------------
// Top-level View
// ---------------------------------------------------------------------------

export interface HandoffsViewProps {
  available: boolean
  handoffs: HandoffRowView[]
  handoffsIsPending: boolean
  handoffsError: unknown
  handoffRowActionsSlot: (props: HandoffRowActionsSlotProps) => ReactNode
}

export function HandoffsView({
  available,
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
            data: { available, handoffs },
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
                    {handoffRowActionsSlot({
                      msgId: handoff.msgId,
                      canClaim: handoff.canClaim,
                      canReply: handoff.canReply,
                      canRequeue: handoff.canRequeue,
                    })}
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
