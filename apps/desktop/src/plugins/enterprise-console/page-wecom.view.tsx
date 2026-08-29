/**
 * WeCom status page (SC5) — Presentational view.
 *
 * Receives a WeComViewModel + fmtIso callback. Renders 3 KPI cards +
 * 2 panels (Integration truth + Recent activity).
 *
 * The eslint config at `apps/desktop/eslint.config.mjs` enforces
 * VIEW_FORBIDDEN_IMPORTS on this file via `no-restricted-imports`.
 *
 * Wave 1 / Step 11 of W5-B0 contract freeze.
 */

import type { ReactNode } from 'react'

import { icons as sdkIcons, StatusDot } from '@hermes/plugin-sdk'

import type { WeComFieldRow, WeComKpiRow, WeComViewModel } from './page-wecom.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, KpiCard, PageHeader } from './ui'

export interface WeComViewProps {
  vm: WeComViewModel
  /** Format an ISO-8601 string → display string. */
  fmtIso: (iso: null | string | undefined) => string
}

function FieldRow({ row, fmtIso }: { row: WeComFieldRow; fmtIso: WeComViewProps['fmtIso'] }): ReactNode {
  // The recentFields rows carry raw ISO strings; route them through
  // fmtIso. Integration-truth rows are already display-ready.
  const isIsoTimestamp =
    row.label === 'last verified inbound' || row.label === 'last outbound'
  const display = isIsoTimestamp ? fmtIso(row.primary) : row.primary

  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-(--ui-stroke-tertiary) py-2 last:border-b-0">
      <span className="text-(--ui-text-secondary)">{row.label}</span>
      <span className="inline-flex min-w-0 items-center gap-1 text-right text-(--ui-text-primary)">
        {row.tone ? <StatusDot tone={row.tone} /> : null}
        <span data-ec-mono={isIsoTimestamp ? '' : undefined}>{display}</span>
        {row.secondary ? (
          <span className="text-(--ui-text-tertiary)" data-ec-mono="">
            {row.secondary}
          </span>
        ) : null}
      </span>
    </div>
  )
}

function KpiRow({ row }: { row: WeComKpiRow }): ReactNode {
  return (
    <KpiCard
      accent={row.accent}
      icon={sdkIcons.Link2}
      label={row.label}
      value={row.value as null | number | string}
    />
  )
}

export function WeComView({ vm, fmtIso }: WeComViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-wecom"
    >
      <PageHeader
        purpose="Tenant-scoped WeCom association, credential presence and recent delivery facts."
        status={<PageStatusBadge status="ready" />}
        title="WeCom status"
      />

      <div className="flex flex-col gap-(--ec-gutter)" data-testid="console-wecom">
        <div className="grid gap-(--ec-gutter) md:grid-cols-2 xl:grid-cols-3">
          {vm.kpis.map(kpi => (
            <KpiRow key={kpi.label} row={kpi} />
          ))}
        </div>

        <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-2">
          <ConsolePanel divided title="Integration truth">
            {vm.integrationFields.map(field => (
              <FieldRow fmtIso={fmtIso} key={field.label} row={field} />
            ))}
          </ConsolePanel>

          <ConsolePanel divided title="Recent activity">
            {vm.recentFields.map(field => (
              <FieldRow fmtIso={fmtIso} key={field.label} row={field} />
            ))}
          </ConsolePanel>
        </div>
      </div>
    </div>
  )
}