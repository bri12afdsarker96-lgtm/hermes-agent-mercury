/**
 * WeCom status page (SC5) — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * The view-model centralizes three tone mappings:
 *   - credential state → StatusTone (PRESENT → good, PARTIAL → warn,
 *     ABSENT → bad, UNKNOWN → muted)
 *   - association_state → StatusTone (BOUND → good, UNBOUND → muted)
 *   - last_delivery_outcome → display string ('—' for null)
 *
 * It also normalizes the credential count string ("N/M" or "—" when
 * the present count is unknown).
 *
 * Wave 1 / Step 11 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { CredentialState, WeComStatus } from './page-wecom.controller'

export interface WeComKpiRow {
  accent: 'brand' | 'knowledge' | 'takeover'
  label: string
  tone: StatusTone
  value: string | number
}

export interface WeComFieldRow {
  label: string
  primary: string
  secondary?: string
  tone: StatusTone
}

export interface WeComViewModel extends CommonViewModelFields {
  /** Three KPI cards: association / runtime credential / bindings. */
  kpis: readonly WeComKpiRow[]
  /** Integration truth fields: association / runtime credential / callback health. */
  integrationFields: readonly WeComFieldRow[]
  /** Recent activity fields: last verified inbound / outbound / delivery outcome. */
  recentFields: readonly WeComFieldRow[]
}

const CREDENTIAL_TONE: Record<CredentialState, StatusTone> = {
  ABSENT: 'bad',
  PARTIAL: 'warn',
  PRESENT: 'good',
  UNKNOWN: 'muted',
}

const ASSOCIATION_TONE = {
  BOUND: 'good' as StatusTone,
  UNBOUND: 'muted' as StatusTone,
}

const DELIVERY_TONE: Record<NonNullable<WeComStatus['last_delivery_outcome']>, StatusTone> = {
  permanent: 'bad',
  success: 'good',
  transient: 'warn',
}

export function deriveWeComViewModel(args: {
  page: ConsolePage
  whoami: null | import('./types').Whoami
  status: WeComStatus | undefined
}): WeComViewModel {
  const { page, whoami, status } = args
  const common = deriveCommonViewModel({ page, whoami })

  const kpis: WeComKpiRow[] = status
    ? [
        {
          accent: 'brand',
          label: 'Association',
          value: status.association_state,
          tone: ASSOCIATION_TONE[status.association_state],
        },
        {
          accent: 'knowledge',
          label: 'Runtime credential',
          value: status.runtime_credential_state,
          tone: CREDENTIAL_TONE[status.runtime_credential_state],
        },
        {
          accent: 'takeover',
          label: 'Bindings',
          value: status.binding_count,
          tone: 'muted',
        },
      ]
    : []

  const credentialFraction =
    status
      ? `(${status.runtime_credential_present_count ?? '—'}/${status.observed_app_config_ref_count})`
      : '—'

  const integrationFields: WeComFieldRow[] = status
    ? [
        {
          label: 'association',
          primary: status.association_state,
          tone: ASSOCIATION_TONE[status.association_state],
        },
        {
          label: 'runtime credential',
          primary: status.runtime_credential_state,
          secondary: credentialFraction,
          tone: CREDENTIAL_TONE[status.runtime_credential_state],
        },
        {
          label: 'callback health',
          primary: 'unknown · not actively probed',
          tone: 'muted',
        },
      ]
    : []

  const recentFields: WeComFieldRow[] = status
    ? [
        {
          label: 'last verified inbound',
          primary: status.last_verified_inbound_at ?? '—',
          tone: 'muted',
        },
        {
          label: 'last outbound',
          primary: status.last_outbound_at ?? '—',
          tone: 'muted',
        },
        {
          label: 'last delivery outcome',
          primary: status.last_delivery_outcome ?? '—',
          tone: status.last_delivery_outcome
            ? DELIVERY_TONE[status.last_delivery_outcome]
            : 'muted',
        },
      ]
    : []

  return {
    ...common,
    kpis,
    integrationFields,
    recentFields,
  }
}