/**
 * Human Handoff page — real `/api/handoffs` (read-only). When the inbox module
 * is unassembled the server returns 501, which QueryBody renders as an honest
 * "server module unavailable" state (never faked).
 */

import { StatusDot, type StatusTone, Textarea } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { ConsoleRows, QueryBody, useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

interface HandoffRow {
  agent_id: null | string
  claim_age_s: null | number
  expires_in_s: null | number
  msg_id: string
  state: string
  status: null | string
  text: string
  thread_id: string
}

interface HandoffsResp {
  available: boolean
  handoffs: HandoffRow[]
}

const STATE_TONE: Record<string, StatusTone> = { escalated: 'warn', parked: 'muted' }

function ageTone(ageSeconds: null | number): StatusTone {
  if (ageSeconds == null) {
    return 'muted'
  }

  if (ageSeconds >= 60) {
    return 'bad'
  }

  return ageSeconds >= 30 ? 'warn' : 'good'
}

const HANDOFFS_KEY = ['enterprise-console', 'handoffs'] as const

function ReplyAction({ msgId }: { msgId: string }) {
  const transport = useTransport()
  const [text, setText] = useState('')

  return (
    <FormAction
      canSubmit={text.trim().length > 0}
      invalidateKey={HANDOFFS_KEY}
      permission="inbox.reply"
      submit={() => transport.post('/api/handoff-reply', { msg_id: msgId, text })}
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

export function HandoffPage() {
  const transport = useTransport()
  const query = useConsoleQuery<HandoffsResp>(HANDOFFS_KEY, '/api/handoffs', 15_000)

  return (
    <div data-page-status="ready" data-testid="console-page-handoff">
      <QueryBody emptyText="no handoffs" isEmpty={data => !data.available || data.handoffs.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-handoffs">
            {data.handoffs.map(handoff => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                key={handoff.msg_id}
              >
                <div className="min-w-0">
                  <div className="truncate">{handoff.text}</div>
                  <div className="text-xs text-muted-foreground">
                    {handoff.agent_id ?? 'unclaimed'}
                    {handoff.status ? ` · ${handoff.status}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  {handoff.claim_age_s != null ? (
                    <span className="inline-flex items-center gap-1">
                      <StatusDot tone={ageTone(handoff.claim_age_s)} />
                      {handoff.claim_age_s}s
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1">
                    <StatusDot tone={STATE_TONE[handoff.state] ?? 'muted'} />
                    {handoff.state}
                  </span>
                  {handoff.agent_id == null ? (
                    <ConfirmAction
                      invalidateKey={HANDOFFS_KEY}
                      permission="inbox.claim"
                      run={() => transport.post('/api/handoff-claim', { msg_id: handoff.msg_id })}
                      testId={`console-handoff-claim-${handoff.msg_id}`}
                      title="Claim this handoff?"
                    >
                      claim
                    </ConfirmAction>
                  ) : null}
                  {handoff.status === 'claimed' ? <ReplyAction msgId={handoff.msg_id} /> : null}
                  {handoff.state === 'parked' ? (
                    <ConfirmAction
                      invalidateKey={HANDOFFS_KEY}
                      permission="inbox.requeue"
                      run={() => transport.post('/api/handoff-requeue', { msg_id: handoff.msg_id })}
                      testId={`console-handoff-requeue-${handoff.msg_id}`}
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
      </QueryBody>
    </div>
  )
}
