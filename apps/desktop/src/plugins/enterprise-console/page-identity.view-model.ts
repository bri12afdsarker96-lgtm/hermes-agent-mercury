/**
 * Identity & Channel Bindings page (SC2) — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * Two derivations:
 *
 *   1. canManageBindings — true iff the viewer holds
 *      `channel.binding.manage`. The view does NOT compute this gate;
 *      the gate is a display-only mirror of the server's authority.
 *
 *   2. principalStatus → StatusTone (active → good, else muted).
 *      binding.status → StatusTone (same).
 *
 * The view-model also flattens the principals list to
 * PrincipalViewRow[] (carrying name + principal_id + status + tone)
 * and the binding list to ChannelBindingViewRow[] (carrying the
 * wire fields plus tone + canRevoke flag).
 *
 * Wave 1 / Step 10 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { hasPermission } from './capabilities'
import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { ChannelBinding, Principal, Whoami } from './page-identity.controller'
import type { Whoami as TypesWhoami } from './types'

export interface PrincipalViewRow {
  displayRole: string
  lastSeenTs: null | number
  name: string
  principalId: string
  status: string
  tenantId: null | string
  tone: StatusTone
}

export interface ChannelBindingViewRow {
  bindingId: string
  canRevoke: boolean
  channel: string
  displaySubject: string
  externalSubject: string
  principalId: string
  status: 'active' | 'revoked'
  tone: StatusTone
  updatedTs: null | string
  version: number
}

export interface PrincipalDropdownOption {
  label: string
  principalId: string
}

export interface IdentityViewModel extends CommonViewModelFields {
  principals: readonly PrincipalViewRow[]
  bindings: readonly ChannelBindingViewRow[]
  /** Display-only mirror of channel.binding.manage permission. */
  canManageBindings: boolean
  /** Dropdown options for the create-binding principal selector. */
  principalOptions: readonly PrincipalDropdownOption[]
  isPrincipalsEmpty: boolean
  isBindingsEmpty: boolean
}

function derivePrincipalTone(status: string): StatusTone {
  return status === 'active' ? 'good' : 'muted'
}

function derivePrincipalRow(principal: Principal): PrincipalViewRow {
  return {
    principalId: principal.principal_id,
    name: principal.name,
    displayRole: principal.role,
    lastSeenTs: principal.last_seen_ts,
    status: principal.status,
    tenantId: principal.tenant_id,
    tone: derivePrincipalTone(principal.status),
  }
}

function deriveBindingTone(status: 'active' | 'revoked'): StatusTone {
  return status === 'active' ? 'good' : 'muted'
}

function deriveBindingRow(binding: ChannelBinding): ChannelBindingViewRow {
  return {
    bindingId: binding.binding_id,
    channel: binding.channel,
    externalSubject: binding.external_subject,
    displaySubject: binding.external_subject,
    principalId: binding.principal_id,
    status: binding.status,
    tone: deriveBindingTone(binding.status),
    updatedTs: binding.updated_ts,
    version: binding.version,
    canRevoke: binding.status === 'active',
  }
}

export function deriveIdentityViewModel(args: {
  page: ConsolePage
  whoami: TypesWhoami | null
  principals: Principal[] | undefined
  bindings: ChannelBinding[] | undefined
}): IdentityViewModel {
  const { page, whoami, principals, bindings } = args
  const common = deriveCommonViewModel({ page, whoami })

  const canManageBindings = whoami ? hasPermission(whoami, 'channel.binding.manage') : false

  const principalRows = (principals ?? []).map(derivePrincipalRow)
  const bindingRows = (bindings ?? []).map(deriveBindingRow)
  const principalOptions: PrincipalDropdownOption[] = (principals ?? []).map(p => ({
    label: `${p.name} (${p.principal_id})`,
    principalId: p.principal_id,
  }))

  return {
    ...common,
    principals: principalRows,
    bindings: bindingRows,
    canManageBindings,
    principalOptions,
    isPrincipalsEmpty: principalRows.length === 0,
    isBindingsEmpty: bindingRows.length === 0,
  }
}

// Suppress unused-Warning: keep Whoami imported only for the type re-export
// above (the page-identity.controller re-uses TypesWhoami elsewhere).
export type { Whoami }