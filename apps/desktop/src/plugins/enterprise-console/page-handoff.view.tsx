/**
 * Human Handoff page — Presentational view.
 *
 * Receives a HandoffViewModel + reply text state + 3 mutation callbacks.
 * The eslint config at `apps/desktop/eslint.config.mjs` enforces
 * VIEW_FORBIDDEN_IMPORTS on this file via `no-restricted-imports`.
 *
 * The view owns the per-row reply text state because it is local UI
 * state (per-row input value) — it does NOT belong in the view-model.
 * The view also renders the three action controls (claim / reply /
 * requeue) by binding them to callbacks; the callbacks were built by
 * the glue layer using the controller's transport-bound mutation
 * factory.
 *
 * Wave 1 / Step 7 of W5-B0 contract freeze.
 */

import { type StatusTone, StatusDot, Textarea } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { ConsoleRows } from './page-kit'
import type { HandoffViewModel } from './page-handoff.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

export interface HandoffViewProps {
  vm: HandoffViewModel
  onClaim: (msgId: string) => void
  onReply: (msgId: string, text: string) => void
  onRequeue: (msgId: string) => void
}

interface ReplyActionProps {
  msgId: string
  onReply: (msgId: string, text: string) => void
}

function ReplyAction({ msgId, onReply }: ReplyActionProps) {
  const [text, setText] = useState('')

  return (
    <FormAction
      canSubmit={text.trim().length > 0}
      invalidateKey={['enterprise-console', 'handoffs']}
      permission="inbox.reply"
      submit={() => {
        onReply(msgId, text)
        setText('')
      }}
      submitLabel="Send"
      testId={`console-handoff-reply-${msgId}`}
      title="Reply to this handoff"
      trigger="reply"
    >
      <Textarea
        data-testid={`console-handoff-reply-text-${msgId}`}
        onChange={event => setText(event.target.value)}
        placeholder="reply text"
        value={text}
      />
    </FormAction>
  )
}

function ToneDot({ tone }: { tone: StatusTone }) {
  return <StatusDot tone={tone} />
}

export function HandoffView({ vm, onClaim, onReply, onRequeue }: HandoffViewProps) {
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
        {vm.isEmpty ? (
          <p className="text-(--ui-text-tertiary)" data-testid="console-handoffs-empty">
            {!vm.isAvailable ? 'inbox module is not assembled' : 'no handoffs'}
          </p>
        ) : (
          <ConsoleRows testId="console-handoffs">
            {vm.rows.map(row => (
              <li
                className="flex min-h-16 items-center justify-between gap-4 border-b border-(--ui-stroke-tertiary) py-3 last:border-b-0"
                key={row.msgId}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-(--ui-text-primary)">{row.text}</div>
                  <div className="mt-0.5 text-(--ui-text-tertiary)">
                    {row.agentId ?? 'unclaimed'}
                    {row.status ? ` · ${row.status}` : ''}
                    {' · '}
                    <span data-ec-mono="">{row.threadId}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-(--ui-text-secondary)">
                  {row.ageLabel != null ? (
                    <span className="inline-flex items-center gap-1" data-ec-mono="">
                      <ToneDot tone={row.ageTone} />
                      {row.ageLabel}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1">
                    <ToneDot tone={row.stateTone} />
                    {row.state}
                  </span>
                  {row.canClaim ? (
                    <ConfirmAction
                      invalidateKey={['enterprise-console', 'handoffs']}
                      permission="inbox.claim"
                      run={() => onClaim(row.msgId)}
                      testId={`console-handoff-claim-${row.msgId}`}
                      title="Claim this handoff?"
                    >
                      claim
                    </ConfirmAction>
                  ) : null}
                  {row.canReply ? <ReplyAction msgId={row.msgId} onReply={onReply} /> : null}
                  {row.canRequeue ? (
                    <ConfirmAction
                      invalidateKey={['enterprise-console', 'handoffs']}
                      permission="inbox.requeue"
                      run={() => onRequeue(row.msgId)}
                      testId={`console-handoff-requeue-${row.msgId}`}
                      title="Requeue this handoff?"
                    >
                      requeue
                    </ConfirmAction>
                  ) : null}
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </ConsolePanel>
    </div>
  )
}