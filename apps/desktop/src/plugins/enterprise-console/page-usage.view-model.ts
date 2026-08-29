/**
 * Usage & Budget page — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 * The view receives a `UsageViewModel` and renders; the controller
 * produces the raw data; this file is the in-between layer.
 *
 * The view-model is honest: when the server has no real-time usage
 * endpoint, `realTimeUsage.value` is `null` and the KpiCard renders an
 * em dash. The availability message is derived from the same server
 * truth, not from a hardcoded string.
 *
 * Step 3 of the W5-B0 contract freeze. See
 * .hermes/plans/2026-08-29_wave1-contract-freeze.md §3.
 */

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { TenantProfileResp } from './page-usage.controller'

/** Renderable shape passed to the Usage view. */
export interface UsageViewModel extends CommonViewModelFields {
  /** Translated label for the daily-budget KpiCard. */
  budgetLabel: string
  /** Always null for now — the server has no real-time usage endpoint. The
   *  KpiCard renders this as an em dash. */
  realTimeUsage: null
  /** Human-readable availability statement, derived from page.gap or
   *  page.status so the view never hard-codes marketing copy. */
  availability: string
}

function formatBudgetLabel(tokens: number | undefined): string {
  if (tokens == null) {
    return 'default (server env)'
  }

  if (tokens === 0) {
    return 'unlimited'
  }

  return `${tokens.toLocaleString()} tokens/day`
}

/** Build the Availability text from page.gap (server truth) or a
 *  honest fallback when the server has no gap description. */
function buildAvailability(page: ConsolePage): string {
  if (page.gap) {
    return page.gap
  }

  return 'Real-time token usage and spend have no server endpoint yet, so no figure or trend is inferred.'
}

export function deriveUsageViewModel(args: {
  page: ConsolePage
  whoami: null | import('./types').Whoami
  data: TenantProfileResp | undefined
}): UsageViewModel {
  const { page, whoami, data } = args
  const common = deriveCommonViewModel({ page, whoami })

  return {
    ...common,
    budgetLabel: formatBudgetLabel(data?.fields?.llm?.daily_budget_tokens),
    realTimeUsage: null,
    availability: buildAvailability(page),
  }
}
