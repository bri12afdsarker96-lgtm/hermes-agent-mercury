/**
 * Enterprise Knowledge page — real `/api/kb-gaps` candidates (read-only this
 * slice). The server reports `knowledge_rag` as DEV, so the page surfaces that
 * maturity honestly (Capability Truth) rather than presenting it as production.
 */

import { StatusDot, type StatusTone, useValue } from '@hermes/plugin-sdk'

import { capabilityStatus } from './capabilities'
import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { CapabilityBadge } from './status-badge'

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

const GAP_TONE: Record<string, StatusTone> = { authored: 'good', new: 'warn', rejected: 'muted' }

export function KnowledgePage() {
  const status = capabilityStatus(useValue($whoami), 'knowledge_rag')
  const query = useConsoleQuery<KbGapsResp>(['enterprise-console', 'kb-gaps'], '/api/kb-gaps?status=new')

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
                <span className="inline-flex shrink-0 items-center gap-1 text-xs">
                  <StatusDot tone={GAP_TONE[gap.status] ?? 'muted'} />
                  {gap.status}
                </span>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}
