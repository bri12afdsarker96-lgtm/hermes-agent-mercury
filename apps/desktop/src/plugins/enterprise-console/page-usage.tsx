/**
 * Usage / Budget page (PARTIAL) — real budget from `/api/tenant-profile`
 * (`fields.llm.daily_budget_tokens`). Real-time token usage has no server
 * endpoint, so it is shown as unavailable rather than faked.
 *
 * Per LINE F · REMEDIATION-01 (P1-SECONDARY-VISUAL-RESPONSIVE-A11Y-01):
 *   - The budget figures block is wrapped in a real
 *     `<section aria-labelledby="...">` paired with a level-2 heading
 *     so screen-reader landmark navigation works AND the heading
 *     level does not skip (PageHeader is h1, this section is h2 —
 *     no h1 → h3 skip).
 *   - The availability disclaimer uses the ConsolePanel h2 that
 *     already exists in the shared primitive (no orphan id, no
 *     nested heading). role="status" + aria-live="polite" remain so
 *     screen readers hear the authoritative-no-fabrication note.
 *   - No shared primitive touched. NO controller, NO contract
 *     change.
 *
 * P1-VIS-V3 — visual productization. The productised layout reads as
 * a real "Usage & budget" surface:
 *   - Two honest KPI tiles (Daily budget · Real-time usage) under
 *     the shared `<section aria-labelledby>` so the budget figures
 *     sit at the page's eye-line.
 *   - A dedicated "Budget source" ConsolePanel that names the
 *     authority for the budget figure (`tenant profile` vs
 *     `server env default`) so a budget number is never presented
 *     without naming where it came from.
 *   - The same `data-page-status="partial"` honest contract and the
 *     same availability disclaimer keep the partial truth visible.
 * No fabricated spend / trend / forecast is added — only the budget
 * value from the tenant profile renders a number, and even that drops
 * to "default (server env)" when the server has not pinned a
 * per-tenant figure.
 */

import { icons, StatusDot } from '@hermes/plugin-sdk'

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

/**
 * Where the budget number actually came from on this render — surfaced as a
 * dedicated ConsolePanel so the page never presents a budget figure without
 * naming its authority. Two values: "tenant profile" when the profile pinned
 * a number, "server env default" when the profile left the field unset.
 */
function budgetSourceLabel(tokens: number | undefined): string {
  return tokens == null ? 'server env default' : 'tenant profile'
}

function budgetSourceTone(tokens: number | undefined): 'good' | 'muted' {
  return tokens == null ? 'muted' : 'good'
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
          const source = budgetSourceLabel(data.fields?.llm?.daily_budget_tokens)
          const sourceTone = budgetSourceTone(data.fields?.llm?.daily_budget_tokens)

          return (
            <>
              <section
                aria-labelledby="console-budget-heading"
                className="grid gap-(--ec-gutter) md:grid-cols-2"
                data-testid="console-budget"
              >
                <h2 className="sr-only" id="console-budget-heading">
                  Budget figures
                </h2>
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
              </section>

              <div className="mt-(--ec-gutter)" data-testid="console-budget-source">
                <ConsolePanel divided title="Budget source">
                  <p className="text-(--ui-text-secondary)">
                    The daily-token-budget figure above comes from the
                    {' '}
                    <span data-ec-mono="">tenant profile</span>
                    {' '}
                    when one is pinned, otherwise the
                    {' '}
                    <span data-ec-mono="">server env default</span>
                    {' '}
                    is used.
                  </p>
                  <p
                    className="mt-2 inline-flex items-center gap-2 text-(--ui-text-primary)"
                    data-testid="console-budget-source-state"
                  >
                    <StatusDot tone={sourceTone} />
                    <span>Current source: {source}</span>
                  </p>
                </ConsolePanel>
              </div>
            </>
          )
        }}
      </QueryBody>

      <ConsolePanel className="mt-(--ec-gutter)" title="Availability">
        <p
          aria-live="polite"
          className="text-(--ui-text-secondary)"
          role="status"
        >
          Budget configuration is authoritative from the tenant profile. Real-time token usage and spend have no server endpoint yet, so no figure or trend is inferred.
        </p>
        <p className="mt-2 text-xs text-(--ui-text-tertiary)" data-testid="console-budget-note">
          Edit budget · period chips · Provider breakdown are honest gaps until the server exposes the corresponding routes. The page never invents a number to fill the slot.
        </p>
      </ConsolePanel>
    </div>
  )
}
