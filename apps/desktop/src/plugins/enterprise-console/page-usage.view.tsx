/**
 * Usage & Budget page — Presentational view.
 *
 * Receives a fully-derivation VM + error message. No transport, no query
 * hooks, no session atoms. Step 3 of the W5-B0 contract freeze.
 *
 * The eslint config at `apps/desktop/eslint.config.mjs` enforces
 * VIEW_FORBIDDEN_IMPORTS on this file via `no-restricted-imports`;
 * any attempt to import transport, query hooks, or session helpers
 * here fails lint with an actionable message.
 */

import { icons } from '@hermes/plugin-sdk'

import { type UsageViewModel } from './page-usage.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, KpiCard, PageHeader } from './ui'

export interface UsageViewProps {
  vm: UsageViewModel
}

/** Pure presentational renderer. Reads only from `vm` (no hooks, no fetch). */
export function UsageView({ vm }: UsageViewProps) {
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

      <div className="grid gap-(--ec-gutter) md:grid-cols-2" data-testid="console-budget">
        <div data-testid="console-budget-value">
          <KpiCard accent="knowledge" icon={icons.CreditCard} label="Daily token budget" value={vm.budgetLabel} />
        </div>
        <KpiCard accent="brand" icon={icons.BarChart3} label="Real-time usage" value={vm.realTimeUsage} />
      </div>

      <ConsolePanel className="mt-(--ec-gutter)" title="Availability">
        <p className="text-(--ui-text-secondary)">{vm.availability}</p>
      </ConsolePanel>
    </div>
  )
}
