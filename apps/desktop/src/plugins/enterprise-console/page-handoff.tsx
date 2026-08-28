/**
 * Human Handoff page — real `/api/handoffs` (read-only). When the inbox module
 * is unassembled the server returns 501, which QueryBody renders as an honest
 * "server module unavailable" state (never faked).
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { ConsoleRows, QueryBody, useConsoleQuery } from './page-kit'

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

export function HandoffPage() {
  const query = useConsoleQuery<HandoffsResp>(['enterprise-console', 'handoffs'], '/api/handoffs', 15_000)

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
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}
