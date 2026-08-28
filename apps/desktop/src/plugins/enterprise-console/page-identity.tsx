/**
 * Identity page (PARTIAL) — real `/api/principals` (read-only). ChannelBinding
 * has no server route yet, so that half is called out rather than faked.
 */

import { StatusDot } from '@hermes/plugin-sdk'

import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'

interface Principal {
  created_ts: number
  last_seen_ts: null | number
  name: string
  principal_id: string
  role: string
  status: string
  tenant_id: null | string
}

interface PrincipalsResp {
  principals: Principal[]
}

export function IdentityPage() {
  const query = useConsoleQuery<PrincipalsResp>(['enterprise-console', 'principals'], '/api/principals')

  return (
    <div className="flex flex-col gap-3" data-page-status="partial" data-testid="console-page-identity">
      <div className="text-xs text-muted-foreground">ChannelBinding management has no server API yet.</div>
      <QueryBody emptyText="no principals" isEmpty={data => data.principals.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-principals">
            {data.principals.map(principal => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                key={principal.principal_id}
              >
                <div className="min-w-0">
                  <div className="truncate">{principal.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {principal.role} · seen {fmtEpoch(principal.last_seen_ts)}
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs">
                  <StatusDot tone={principal.status === 'active' ? 'good' : 'muted'} />
                  {principal.status}
                </span>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}
