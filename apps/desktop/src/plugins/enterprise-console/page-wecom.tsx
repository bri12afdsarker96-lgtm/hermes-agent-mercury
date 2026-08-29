/**
 * WeCom association/integration status page (SC5) — real `/api/wecom-status`.
 * READ-ONLY: aggregate non-secret tenant facts only. `runtime_credential_state`
 * is a UNKNOWN/ABSENT/PARTIAL/PRESENT membership judgement over the tenant's OWN
 * observed app_config_ref — never a credential, never asserted PRESENT from
 * silence. `callback_health` is always 'unknown' in Phase-1 (not actively
 * probed) and is shown honestly, not inferred from an absence of inbound.
 * Gated by `channel.binding.manage` (tenant integration config; tenant_admin).
 */

import { icons, StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { fmtIso, QueryBody, useConsoleQuery } from './page-kit'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, KpiCard, PageHeader } from './ui'

type CredentialState = 'ABSENT' | 'PARTIAL' | 'PRESENT' | 'UNKNOWN'

interface WeComStatus {
  association_state: 'BOUND' | 'UNBOUND'
  binding_count: number
  callback_health: 'unknown'
  last_delivery_outcome: 'permanent' | 'success' | 'transient' | null
  last_outbound_at: null | string
  last_verified_inbound_at: null | string
  observed_app_config_ref_count: number
  runtime_credential_present_count: null | number
  runtime_credential_state: CredentialState
}

interface WeComStatusResp {
  wecom: WeComStatus
}

const WECOM_KEY = ['enterprise-console', 'wecom-status'] as const

const CREDENTIAL_TONE: Record<CredentialState, StatusTone> = {
  ABSENT: 'bad',
  PARTIAL: 'warn',
  PRESENT: 'good',
  UNKNOWN: 'muted'
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-(--ui-stroke-tertiary) py-2 last:border-b-0">
      <span className="text-(--ui-text-secondary)">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-1 text-right text-(--ui-text-primary)">{children}</span>
    </div>
  )
}

export function WeComPage() {
  const query = useConsoleQuery<WeComStatusResp>(WECOM_KEY, '/api/wecom-status')

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

      <QueryBody emptyText="—" query={query}>
        {data => {
          const status = data.wecom

          return (
            <div className="flex flex-col gap-(--ec-gutter)" data-testid="console-wecom">
              <div className="grid gap-(--ec-gutter) md:grid-cols-2 xl:grid-cols-3">
                <KpiCard
                  accent="brand"
                  icon={icons.Link2}
                  label="Association"
                  value={status.association_state}
                />
                <KpiCard
                  accent="knowledge"
                  icon={icons.KeyRound}
                  label="Runtime credential"
                  value={status.runtime_credential_state}
                />
                <KpiCard accent="takeover" icon={icons.Users} label="Bindings" value={status.binding_count} />
              </div>

              <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-2">
                <ConsolePanel divided title="Integration truth">
                  <Field label="association">
                    <StatusDot tone={status.association_state === 'BOUND' ? 'good' : 'muted'} />
                    {status.association_state}
                  </Field>
                  <Field label="runtime credential">
                    <StatusDot tone={CREDENTIAL_TONE[status.runtime_credential_state]} />
                    {status.runtime_credential_state}
                    <span className="text-(--ui-text-tertiary)" data-ec-mono="">
                      ({status.runtime_credential_present_count ?? '—'}/{status.observed_app_config_ref_count})
                    </span>
                  </Field>
                  <Field label="callback health">
                    <span className="text-(--ui-text-secondary)">{status.callback_health} · not actively probed</span>
                  </Field>
                </ConsolePanel>

                <ConsolePanel divided title="Recent activity">
                  <Field label="last verified inbound">
                    <span data-ec-mono="">{fmtIso(status.last_verified_inbound_at)}</span>
                  </Field>
                  <Field label="last outbound">
                    <span data-ec-mono="">{fmtIso(status.last_outbound_at)}</span>
                  </Field>
                  <Field label="last delivery outcome">{status.last_delivery_outcome ?? '—'}</Field>
                </ConsolePanel>
              </div>
            </div>
          )
        }}
      </QueryBody>
    </div>
  )
}
