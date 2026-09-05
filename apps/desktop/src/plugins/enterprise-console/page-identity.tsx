/**
 * Identity page (SC2) — real `/api/principals` (read-only) plus a ChannelBinding
 * management section (`/api/channel-bindings-list` + create/revoke) that is
 * gated in-component on `channel.binding.manage` (tenant_admin-only): the page
 * itself is reachable with `principal.crud`, but the binding controls only
 * appear for a principal the server would actually authorize. The server is the
 * real gate; this gate is UI-display only. Principal timestamps are epoch
 * numbers (fmtEpoch); binding timestamps are ISO strings (fmtIso).
 *
 * P1-VIS-V3 — visual productization. Adopted the approved ConsolePanel /
 * DataTable / KpiCard / PageHeader geometry so this page reads at product
 * quality while preserving every frozen contract: the four-row principal
 * projection (name / principal_id / role / status), the ten-column binding
 * projection, the exact create/revoke bodies, the 401/403/503 honest error
 * paths, and the UI-display-only permission affordance for binding management.
 * No new server endpoint, no shared-seam change, no fabricated row.
 */

import { Input, StatusDot, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { hasPermission } from './capabilities'
import { ConsoleRows, fmtEpoch, fmtIso, QueryBody, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { PageStatusBadge } from './status-badge'
import { useTransport } from './transport'
import {
  ConsolePanel,
  DataTable,
  type DataTableColumn,
  PageHeader
} from './ui'

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

/**
 * Build the binding DataTable column set, closing over the live transport so
 * the per-row `run` callback can post without violating the rules of hooks.
 */
function buildBindingColumns(transport: ReturnType<typeof useTransport>): DataTableColumn<ChannelBinding>[] {
  return [
    {
      cell: row => (
        <span className="font-medium text-(--ui-text-primary)">
          <span className="block truncate">{row.channel}</span>
          <span className="block text-xs text-(--ui-text-tertiary)">{row.external_subject}</span>
        </span>
      ),
      header: '通道 / 外部主体',
      key: 'channel',
      width: '34%'
    },
    {
      cell: row => (
        <span className="text-(--ui-text-secondary)">
          <span data-ec-mono="">{row.principal_id}</span>
        </span>
      ),
      header: '成员',
      key: 'principal_id',
      width: '20%'
    },
    {
      cell: row => (
        <span className="text-(--ui-text-secondary)" data-ec-mono="">
          v{row.version} · {fmtIso(row.updated_ts)}
        </span>
      ),
      header: '版本 / 更新时间',
      key: 'version',
      width: '22%'
    },
    {
      align: 'end',
      cell: row => (
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-(--ui-text-secondary)">
            <StatusDot tone={row.status === 'active' ? 'good' : 'muted'} />
            {row.status}
          </span>
        </span>
      ),
      header: '状态',
      key: 'status',
      width: '14%'
    },
    {
      align: 'end',
      cell: row =>
        row.status === 'active' ? (
          <ConfirmAction
            description="This revokes the binding on the server."
            destructive
            invalidateKey={CHANNEL_BINDINGS_KEY}
            permission="channel.binding.manage"
            run={() => transport.post('/api/channel-binding-revoke', { binding_id: row.binding_id })}
            testId={`console-binding-revoke-${row.binding_id}`}
            title="Revoke this binding?"
          >
            revoke
          </ConfirmAction>
        ) : null,
      header: '',
      key: 'ops',
      width: '10%'
    }
  ]
}

const PRINCIPAL_COLUMNS: DataTableColumn<Principal>[] = [
  {
    cell: row => (
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--ec-module-knowledge) text-(--ui-text-inverse) text-xs font-semibold"
        >
          {row.name.slice(0, 1)}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-(--ui-text-primary)">{row.name}</span>
          <span className="block text-xs text-(--ui-text-tertiary)">
            <span data-ec-mono="">{row.principal_id}</span>
          </span>
        </span>
      </span>
    ),
    header: '成员',
    key: 'name',
    width: '40%'
  },
  {
    cell: row => (
      <span className="text-(--ui-text-secondary)">
        <span data-ec-mono="">{row.role}</span>
      </span>
    ),
    header: '角色',
    key: 'role',
    width: '20%'
  },
  {
    cell: row => (
      <span className="text-(--ui-text-secondary)" data-ec-mono="">
        {fmtEpoch(row.last_seen_ts)}
      </span>
    ),
    header: '最近活跃',
    key: 'last_seen',
    width: '25%'
  },
  {
    align: 'end',
    cell: row => (
      <span className="inline-flex items-center gap-1 text-(--ui-text-secondary)">
        <StatusDot tone={row.status === 'active' ? 'good' : 'muted'} />
        {row.status}
      </span>
    ),
    header: '状态',
    key: 'status',
    width: '15%'
  }
]

function PrincipalsSection() {
  const query = useConsoleQuery<PrincipalsResp>(PRINCIPALS_KEY, '/api/principals')

  return (
    <ConsolePanel divided title="Principals">
      <QueryBody emptyText="no principals" isEmpty={data => data.principals.length === 0} query={query}>
        {data => (
          <div className="-mx-(--ec-panel-pad) -mb-(--ec-panel-pad)">
            <DataTable
              caption="Tenant principals"
              columns={PRINCIPAL_COLUMNS}
              rowKey={row => row.principal_id}
              rows={data.principals}
            />
            {/* Legacy list surface preserved as a sibling for any contract test
                that still walks `console-principals` (rows are the real data). */}
            <ConsoleRows testId="console-principals">
              {data.principals.map(principal => (
                <li
                  className="sr-only"
                  data-principal-id={principal.principal_id}
                  key={`legacy-${principal.principal_id}`}
                >
                  {principal.name} {principal.principal_id} {principal.role} {principal.status}
                </li>
              ))}
            </ConsoleRows>
          </div>
        )}
      </QueryBody>
    </ConsolePanel>
  )
}

function CreateBinding() {
  const transport = useTransport()
  const principals = useConsoleQuery<PrincipalsResp>(PRINCIPALS_KEY, '/api/principals')
  const [channel, setChannel] = useState('')
  const [externalSubject, setExternalSubject] = useState('')
  const [principalId, setPrincipalId] = useState('')

  return (
    <FormAction
      canSubmit={channel.trim().length > 0 && externalSubject.trim().length > 0 && principalId.length > 0}
      invalidateKey={CHANNEL_BINDINGS_KEY}
      permission="channel.binding.manage"
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
        aria-label="principal"
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
  const columns = buildBindingColumns(transport)

  return (
    <ConsolePanel action={<CreateBinding />} divided title="Channel bindings">
      <QueryBody emptyText="no channel bindings" isEmpty={data => data.bindings.length === 0} query={query}>
        {data => (
          <div className="-mx-(--ec-panel-pad) -mb-(--ec-panel-pad)">
            <DataTable
              caption="Channel bindings"
              columns={columns}
              rowKey={row => row.binding_id}
              rows={data.bindings}
            />
            <ConsoleRows testId="console-channel-bindings">
              {data.bindings.map(binding => (
                <li
                  className="sr-only"
                  data-binding-id={binding.binding_id}
                  key={`legacy-${binding.binding_id}`}
                >
                  {binding.channel} {binding.external_subject} {binding.principal_id} v{binding.version}{' '}
                  {binding.status}
                </li>
              ))}
            </ConsoleRows>
          </div>
        )}
      </QueryBody>
    </ConsolePanel>
  )
}

export function IdentityPage() {
  const who = useValue($whoami)
  const canManageBindings = who ? hasPermission(who, 'channel.binding.manage') : false

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-identity"
    >
      <PageHeader
        purpose="Principal visibility and tenant-scoped external channel bindings through server authority."
        status={<PageStatusBadge status="ready" />}
        title="Identity & channel bindings"
      />

      <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-2">
        <PrincipalsSection />
        {canManageBindings ? <ChannelBindingsSection /> : null}
      </div>
    </div>
  )
}
