/**
 * Identity page (SC2) — real `/api/principals` (read-only) plus a ChannelBinding
 * management section (`/api/channel-bindings-list` + create/revoke) that is
 * gated in-component on `channel.binding.manage` (tenant_admin-only): the page
 * itself is reachable with `principal.crud`, but the binding controls only
 * appear for a principal the server would actually authorize. The server is the
 * real gate; this gate is UI-display only. Principal timestamps are epoch
 * numbers (fmtEpoch); binding timestamps are ISO strings (fmtIso).
 */

import { Input, StatusDot, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { hasPermission } from './capabilities'
import { ConsoleRows, fmtEpoch, fmtIso, QueryBody, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { useTransport } from './transport'

interface Principal {
  created_ts: number
  last_seen_ts: null | number
  name: string
  principal_id: string
  role: string
  status: string
  tenant_id: null | string
}

interface PrincipalsResp {
  principals: Principal[]
}

interface ChannelBinding {
  binding_id: string
  channel: string
  created_ts: null | string
  external_subject: string
  principal_id: string
  revoked_by_principal_id: null | string
  revoked_ts: null | string
  status: 'active' | 'revoked'
  updated_ts: null | string
  version: number
}

interface ChannelBindingsListResp {
  bindings: ChannelBinding[]
}

const PRINCIPALS_KEY = ['enterprise-console', 'principals'] as const
const CHANNEL_BINDINGS_KEY = ['enterprise-console', 'channel-bindings'] as const

function PrincipalsSection() {
  const query = useConsoleQuery<PrincipalsResp>(PRINCIPALS_KEY, '/api/principals')

  return (
    <QueryBody emptyText="no principals" isEmpty={data => data.principals.length === 0} query={query}>
      {data => (
        <ConsoleRows testId="console-principals">
          {data.principals.map(principal => (
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              key={principal.principal_id}
            >
              <div className="min-w-0">
                <div className="truncate">{principal.name}</div>
                <div className="text-xs text-muted-foreground">
                  {principal.role} · seen {fmtEpoch(principal.last_seen_ts)}
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs">
                <StatusDot tone={principal.status === 'active' ? 'good' : 'muted'} />
                {principal.status}
              </span>
            </li>
          ))}
        </ConsoleRows>
      )}
    </QueryBody>
  )
}

function CreateBinding() {
  const transport = useTransport()
  // Reuses the principals cache (same query key) for the target picker.
  const principals = useConsoleQuery<PrincipalsResp>(PRINCIPALS_KEY, '/api/principals')
  const [channel, setChannel] = useState('')
  const [externalSubject, setExternalSubject] = useState('')
  const [principalId, setPrincipalId] = useState('')

  return (
    <FormAction
      canSubmit={channel.trim().length > 0 && externalSubject.trim().length > 0 && principalId.length > 0}
      invalidateKey={CHANNEL_BINDINGS_KEY}
      submit={() =>
        transport.post('/api/channel-binding-create', {
          channel: channel.trim(),
          external_subject: externalSubject.trim(),
          principal_id: principalId
        })
      }
      submitLabel="Create"
      testId="console-binding-create"
      title="Create channel binding"
      trigger="new binding"
    >
      <Input
        data-testid="console-binding-create-channel"
        onChange={event => setChannel(event.target.value)}
        placeholder="channel (e.g. wecom)"
        value={channel}
      />
      <Input
        data-testid="console-binding-create-subject"
        onChange={event => setExternalSubject(event.target.value)}
        placeholder="external_subject"
        value={externalSubject}
      />
      <select
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        data-testid="console-binding-create-principal"
        onChange={event => setPrincipalId(event.target.value)}
        value={principalId}
      >
        <option value="">select principal…</option>
        {(principals.data?.principals ?? []).map(principal => (
          <option key={principal.principal_id} value={principal.principal_id}>
            {principal.name} ({principal.principal_id})
          </option>
        ))}
      </select>
    </FormAction>
  )
}

function ChannelBindingsSection() {
  const transport = useTransport()
  const query = useConsoleQuery<ChannelBindingsListResp>(CHANNEL_BINDINGS_KEY, '/api/channel-bindings-list')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">channel bindings</div>
        <CreateBinding />
      </div>
      <QueryBody emptyText="no channel bindings" isEmpty={data => data.bindings.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-channel-bindings">
            {data.bindings.map(binding => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                key={binding.binding_id}
              >
                <div className="min-w-0">
                  <div className="truncate">
                    {binding.channel} · {binding.external_subject}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {binding.principal_id} · v{binding.version} · {fmtIso(binding.updated_ts)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={binding.status === 'active' ? 'good' : 'muted'} />
                    {binding.status}
                  </span>
                  {binding.status === 'active' ? (
                    <ConfirmAction
                      description="This revokes the binding on the server."
                      destructive
                      invalidateKey={CHANNEL_BINDINGS_KEY}
                      run={() => transport.post('/api/channel-binding-revoke', { binding_id: binding.binding_id })}
                      testId={`console-binding-revoke-${binding.binding_id}`}
                      title="Revoke this binding?"
                    >
                      revoke
                    </ConfirmAction>
                  ) : null}
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}

export function IdentityPage() {
  const who = useValue($whoami)
  const canManageBindings = who ? hasPermission(who, 'channel.binding.manage') : false

  return (
    <div className="flex flex-col gap-4" data-page-status="ready" data-testid="console-page-identity">
      <PrincipalsSection />
      {canManageBindings ? <ChannelBindingsSection /> : null}
    </div>
  )
}
