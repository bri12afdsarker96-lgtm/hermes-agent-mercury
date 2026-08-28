/**
 * Enterprise Knowledge page — real `/api/kb-gaps` candidates + the review flow
 * (author / reject) via real server routes. The server reports `knowledge_rag`
 * as DEV, surfaced honestly (Capability Truth). Publish (commit) / withdraw
 * (delete) need the upload surface — a later slice (control status = partial).
 */

import { Input, StatusDot, type StatusTone, Textarea, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { FormAction } from './actions'
import { capabilityStatus } from './capabilities'
import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { CapabilityBadge } from './status-badge'
import { useTransport } from './transport'

interface KbGap {
  biz_line: null | string
  gap_id: string
  hits: number
  query: string
  signal: string
  status: string
  ts_last: number
}

interface KbGapsResp {
  collections: string[]
  count: number
  error?: string
  gaps: KbGap[]
}

const KB_KEY = ['enterprise-console', 'kb-gaps'] as const

const GAP_TONE: Record<string, StatusTone> = { authored: 'good', new: 'warn', rejected: 'muted' }

function GapReview({ gapId }: { gapId: string }) {
  const transport = useTransport()
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [reason, setReason] = useState('')

  return (
    <div className="flex shrink-0 items-center gap-1">
      <FormAction
        canSubmit={text.trim().length > 0}
        invalidateKey={KB_KEY}
        submit={() => transport.post('/api/kb-gap-author', { gap_id: gapId, source: source || undefined, text })}
        submitLabel="Author"
        testId={`kb-author-${gapId}`}
        title="Author an answer"
        trigger="author"
      >
        <Textarea
          data-testid={`kb-author-text-${gapId}`}
          onChange={event => setText(event.target.value)}
          placeholder="answer text"
          value={text}
        />
        <Input onChange={event => setSource(event.target.value)} placeholder="source (optional)" value={source} />
      </FormAction>
      <FormAction
        canSubmit={reason.trim().length > 0}
        invalidateKey={KB_KEY}
        submit={() => transport.post('/api/kb-gap-reject', { gap_id: gapId, reason })}
        submitLabel="Reject"
        testId={`kb-reject-${gapId}`}
        title="Reject this gap"
        trigger="reject"
      >
        <Input
          data-testid={`kb-reject-reason-${gapId}`}
          onChange={event => setReason(event.target.value)}
          placeholder="reason"
          value={reason}
        />
      </FormAction>
    </div>
  )
}

export function KnowledgePage() {
  const status = capabilityStatus(useValue($whoami), 'knowledge_rag')
  const query = useConsoleQuery<KbGapsResp>(KB_KEY, '/api/kb-gaps?status=new')

  return (
    <div className="flex flex-col gap-3" data-page-status="ready-dev" data-testid="console-page-knowledge">
      {status && status !== 'LIVE' ? (
        <div
          className="flex items-center gap-2 rounded-md border border-border p-2 text-xs"
          data-testid="console-knowledge-dev"
        >
          <CapabilityBadge status={status} />
          <span className="text-muted-foreground">knowledge RAG is not production-live on this server</span>
        </div>
      ) : null}
      <QueryBody emptyText="no knowledge gaps" isEmpty={data => data.gaps.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-kb-gaps">
            {data.gaps.map(gap => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                key={gap.gap_id}
              >
                <div className="min-w-0">
                  <div className="truncate">{gap.query}</div>
                  <div className="text-xs text-muted-foreground">
                    {gap.signal} · hits {gap.hits} · {fmtEpoch(gap.ts_last)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={GAP_TONE[gap.status] ?? 'muted'} />
                    {gap.status}
                  </span>
                  {gap.status === 'new' ? <GapReview gapId={gap.gap_id} /> : null}
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}
