/**
 * Usage / Budget page (PARTIAL) — real budget from `/api/tenant-profile`
 * (`fields.llm.daily_budget_tokens`). Real-time token usage has no server
 * endpoint, so it is shown as unavailable rather than faked.
 */

import { QueryBody, useConsoleQuery } from './page-kit'

interface TenantProfileResp {
  fields: { llm?: { daily_budget_tokens?: number } }
  tenant_id: string
  version: number
}

function budgetLabel(tokens: number | undefined): string {
  if (tokens == null) {
    return 'default (server env)'
  }

  if (tokens === 0) {
    return 'unlimited'
  }

  return `${tokens.toLocaleString()} tokens/day`
}

export function UsagePage() {
  const query = useConsoleQuery<TenantProfileResp>(['enterprise-console', 'tenant-profile'], '/api/tenant-profile')

  return (
    <div className="flex flex-col gap-3" data-page-status="partial" data-testid="console-page-usage">
      <QueryBody emptyText="no profile" query={query}>
        {data => (
          <div className="rounded-md border border-border p-3" data-testid="console-budget">
            <div className="text-xs font-medium text-muted-foreground">daily budget</div>
            <div className="mt-1 text-sm" data-testid="console-budget-value">
              {budgetLabel(data.fields?.llm?.daily_budget_tokens)}
            </div>
          </div>
        )}
      </QueryBody>
      <div className="text-xs text-muted-foreground">Real-time token usage has no server endpoint yet.</div>
    </div>
  )
}
