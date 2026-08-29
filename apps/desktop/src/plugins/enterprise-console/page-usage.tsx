/**
 * Usage & Budget page — Glue layer.
 *
 * Composes the controller (query), view-model (derivation), and view
 * (rendering). This is the only place that wires the three together.
 * A 4-line file by design: if it grows, one of the three layers
 * is wrong.
 *
 * Step 3 of the W5-B0 contract freeze. See
 * .hermes/plans/2026-08-29_wave1-contract-freeze.md §3.
 */

import { findPage } from './catalog'
import { QueryBody } from './page-kit'
import { useWhoami } from './session'
import { useUsageData } from './page-usage.controller'
import { deriveUsageViewModel } from './page-usage.view-model'
import { UsageView } from './page-usage.view'

export function UsagePage() {
  const who = useWhoami()
  const query = useUsageData()
  const page = findPage('usage')!

  return (
    <QueryBody emptyText="no profile" query={query}>
      {data => <UsageView vm={deriveUsageViewModel({ page, whoami: who, data })} />}
    </QueryBody>
  )
}
