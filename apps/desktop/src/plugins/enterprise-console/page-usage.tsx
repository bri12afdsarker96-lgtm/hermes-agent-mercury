/**
 * Usage / Budget page (PARTIAL) — real budget from `/api/tenant-profile`
 * (`fields.llm.daily_budget_tokens`). Real-time token usage has no server
 * endpoint, so it is shown as unavailable rather than faked.
 */

import { icons } from '@hermes/plugin-sdk'

import { QueryBody, useConsoleQuery } from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, KpiCard, PageHeader } from './ui'

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
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="partial"
      data-testid="console-page-usage"
    >
      <PageHeader
        purpose="Configured tenant budget with explicit gaps where real-time usage authority does not yet exist."
        status={<PageStatusBadge status="partial" />}
        title="Usage & budget"
      />

      <QueryBody emptyText="no profile" query={query}>
        {data => (
          <div className="grid gap-(--ec-gutter) md:grid-cols-2" data-testid="console-budget">
            <KpiCard
              accent="knowledge"
              icon={icons.CreditCard}
              label="Daily token budget"
              value={budgetLabel(data.fields?.llm?.daily_budget_tokens)}
            />
            <KpiCard accent="brand" icon={icons.BarChart3} label="Real-time usage" value={null} />
          </div>
        )}
      </QueryBody>

      <ConsolePanel className="mt-(--ec-gutter)" title="Availability">
        <p className="text-(--ui-text-secondary)" data-testid="console-budget-value">
          Budget configuration is authoritative from the tenant profile. Real-time token usage and spend have no server endpoint yet, so no figure or trend is inferred.
        </p>
      </ConsolePanel>
    </div>
  )
}
