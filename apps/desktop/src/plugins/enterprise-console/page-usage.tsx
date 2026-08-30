/**
 * Usage / Budget page (PARTIAL) — real budget from `/api/tenant-profile`
 * (`fields.llm.daily_budget_tokens`). Real-time token usage has no server
 * endpoint, so it is shown as unavailable rather than faked.
 *
 * Per LINE F (P1-SECONDARY-VISUAL-RESPONSIVE-A11Y-01):
 *   - Visual-only additions: section aria-labelledby, the unavailable
 *     KPI is announced as such via aria-label, empty/error states use
 *     richer copy, the availability panel uses role="status" so
 *     screen readers hear the disclaimer. NO controller, NO
 *     contract change.
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

      <QueryBody
        emptyText="no tenant profile — daily budget authority is unavailable on this server"
        query={query}
      >
        {data => {
          const budget = budgetLabel(data.fields?.llm?.daily_budget_tokens)

          return (
            <div
              aria-labelledby="console-budget-heading"
              className="grid gap-(--ec-gutter) md:grid-cols-2"
              data-testid="console-budget"
            >
              <h3 className="sr-only" id="console-budget-heading">
                Budget figures
              </h3>
              <div data-testid="console-budget-value">
                <KpiCard
                  accent="knowledge"
                  icon={icons.CreditCard}
                  label="Daily token budget"
                  value={budget}
                />
              </div>
              <div data-testid="console-budget-realtime">
                <KpiCard
                  accent="brand"
                  icon={icons.BarChart3}
                  label="Real-time usage"
                  value={null}
                />
              </div>
            </div>
          )
        }}
      </QueryBody>

      <ConsolePanel
        className="mt-(--ec-gutter)"
        title={
          <span
            className="text-sm font-medium"
            id="console-usage-availability-heading"
          >
            Availability
          </span>
        }
      >
        <p
          aria-live="polite"
          className="text-(--ui-text-secondary)"
          role="status"
        >
          Budget configuration is authoritative from the tenant profile. Real-time token usage and spend have no server endpoint yet, so no figure or trend is inferred.
        </p>
      </ConsolePanel>
    </div>
  )
}
