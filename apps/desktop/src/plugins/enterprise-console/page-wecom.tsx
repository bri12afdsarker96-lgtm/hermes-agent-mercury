/**
 * WeCom association/integration status page (SC5) — real `/api/wecom-status`.
 * READ-ONLY: aggregate non-secret tenant facts only. `runtime_credential_state`
 * is a UNKNOWN/ABSENT/PARTIAL/PRESENT membership judgement over the tenant's OWN
 * observed app_config_ref — never a credential, never asserted PRESENT from
 * silence. `callback_health` is always 'unknown' in Phase-1 (not actively
 * probed) and is shown honestly, not inferred from an absence of inbound.
 * Gated by `channel.binding.manage` (tenant integration config; tenant_admin).
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { fmtIso, QueryBody, useConsoleQuery } from './page-kit'

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
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1 text-right">{children}</span>
    </div>
  )
}

export function WeComPage() {
  const query = useConsoleQuery<WeComStatusResp>(WECOM_KEY, '/api/wecom-status')

  return (
    <div className="flex flex-col gap-2" data-page-status="ready" data-testid="console-page-wecom">
      <QueryBody emptyText="—" query={query}>
        {data => {
          const status = data.wecom

          return (
            <div className="flex flex-col gap-1.5" data-testid="console-wecom">
              <Field label="association">
                <StatusDot tone={status.association_state === 'BOUND' ? 'good' : 'muted'} />
                {status.association_state}
              </Field>
              <Field label="runtime credential">
                <StatusDot tone={CREDENTIAL_TONE[status.runtime_credential_state]} />
                {status.runtime_credential_state}
                <span className="text-xs text-muted-foreground">
                  ({status.runtime_credential_present_count ?? '—'}/{status.observed_app_config_ref_count})
                </span>
              </Field>
              <Field label="bindings">{status.binding_count}</Field>
              <Field label="last verified inbound">{fmtIso(status.last_verified_inbound_at)}</Field>
              <Field label="last outbound">{fmtIso(status.last_outbound_at)}</Field>
              <Field label="last delivery outcome">{status.last_delivery_outcome ?? '—'}</Field>
              <Field label="callback health">
                <span className="text-muted-foreground">{status.callback_health} (not actively probed)</span>
              </Field>
            </div>
          )
        }}
      </QueryBody>
    </div>
  )
}
