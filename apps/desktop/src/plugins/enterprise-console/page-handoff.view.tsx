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
 *
 * Per LINE F (P1-SECONDARY-VISUAL-RESPONSIVE-A11Y-01):
 *   - Visual-only additions: section aria-labelledby, row
 *     aria-label, status aria-label, empty-text improvement,
 *     flex-wrap for narrow viewports. NO controller, NO
 *     contract change.
 *
 * Per P1-VIS-V2 (Minimal Handoff productization):
 *   - Status strip: same shape as Reminder's strip — narrow-layout
 *     accessible region exposing server availability + count.
 *   - PageHeader status badge: <PageStatusBadge status=
 *     {available ? 'ready' : 'partial'} /> — HONEST mapping.
 *   - data-ec-handoff-state on each row = the server state
 *     ('parked' / 'escalated' / etc.) for narrow-layout debugging.
 *   - data-ec-mono on the threadId span = the design's
 *     mono-literal pattern.
 *   - NO additional eligibility derivation. NO advanced handoff
 *     features. NO Business Follow-up contamination.
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
      className="mx-auto flex w-full max-w-[96rem] flex-col gap-(--ec-page-inset-y) px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status={available ? 'ready' : 'partial'}
      data-testid="console-page-handoff"
    >
      <PageHeader
        purpose="Claim, reply and requeue human handoffs through authoritative inbox workflows."
        status={<PageStatusBadge status={available ? 'ready' : 'partial'} />}
        title="Human handoff"
      />

      <section
        aria-labelledby="console-handoffs-status-heading"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--ui-text-tertiary)"
        data-ec-state={available ? 'available' : 'unavailable'}
        data-testid="console-handoffs-status"
      >
        <h2 className="sr-only" id="console-handoffs-status-heading">
          Handoff server availability
        </h2>
        <span className="inline-flex items-center gap-1">
          <StatusDot tone={available ? 'good' : 'bad'} />
          {available
            ? 'server-authoritative · claim / reply / requeue post to /api/handoff-*'
            : 'handoffs unavailable · server reports available=false'}
        </span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span>
          {handoffs.length} handoff{handoffs.length === 1 ? '' : 's'}
        </span>
      </section>

      <ConsolePanel divided title="Handoff queue">
        <QueryBody
          emptyText="no handoffs — when a conversation needs a human, it lands here"
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
                  aria-label={`handoff ${handoff.msgId}, thread ${handoff.threadId}, state ${handoff.state}${handoff.ageSeconds != null ? `, ${handoff.ageSeconds}s old` : ''}`}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) py-3 last:border-b-0"
                  data-ec-handoff-state={handoff.state}
                  data-testid={`console-handoff-row-${handoff.msgId}`}
                  key={handoff.msgId}
                >
                  <div className="min-w-0 flex-1">
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
                        aria-label={`age ${handoff.ageSeconds} seconds`}
                        className="inline-flex items-center gap-1"
                        data-ec-mono=""
                      >
                        <StatusDot tone={handoff.ageTone} />
                        {handoff.ageSeconds}s
                      </span>
                    ) : null}
                    <span
                      aria-label={`state ${handoff.state}`}
                      className="inline-flex items-center gap-1"
                    >
                      <StatusDot tone={handoff.stateTone} />
                      {handoff.stateLabel}
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
