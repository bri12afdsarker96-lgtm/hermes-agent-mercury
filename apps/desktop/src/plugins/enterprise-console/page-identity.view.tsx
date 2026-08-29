/**
 * Identity & Channel Bindings page (SC2) — Presentational view.
 *
 * Receives an IdentityViewModel + create-binding form state + 2
 * mutation callbacks + 2 formatter callbacks (fmtEpoch / fmtIso).
 *
 * The CreateBindingForm sub-component owns the form's local state
 * (channel / externalSubject / principalId).
 *
 * Wave 1 / Step 10 of W5-B0 contract freeze.
 */

import { Input, StatusDot } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { ConsoleRows } from './page-kit'
import type { IdentityViewModel } from './page-identity.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

export interface IdentityViewProps {
  vm: IdentityViewModel
  onCreateBinding: (body: { channel: string; external_subject: string; principal_id: string }) => void
  onRevokeBinding: (bindingId: string) => void
  /** Format a server epoch (seconds) → display string. */
  fmtEpoch: (seconds: null | number | undefined) => string
  /** Format a server ISO-8601 string → display string. */
  fmtIso: (iso: null | string | undefined) => string
}

interface CreateBindingFormProps {
  vm: IdentityViewModel
  onCreateBinding: IdentityViewProps['onCreateBinding']
}

function CreateBindingForm({ vm, onCreateBinding }: CreateBindingFormProps) {
  const [channel, setChannel] = useState('')
  const [externalSubject, setExternalSubject] = useState('')
  const [principalId, setPrincipalId] = useState('')

  const canSubmit =
    channel.trim().length > 0 && externalSubject.trim().length > 0 && principalId.length > 0

  return (
    <FormAction
      canSubmit={canSubmit}
      invalidateKey={['enterprise-console', 'channel-bindings']}
      permission="channel.binding.manage"
      submit={() => {
        onCreateBinding({
          channel: channel.trim(),
          external_subject: externalSubject.trim(),
          principal_id: principalId,
        })
        setChannel('')
        setExternalSubject('')
        setPrincipalId('')
      }}
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
        {vm.principalOptions.map(option => (
          <option key={option.principalId} value={option.principalId}>
            {option.label}
          </option>
        ))}
      </select>
    </FormAction>
  )
}

function PrincipalsPanel({ vm, fmtEpoch }: { vm: IdentityViewModel; fmtEpoch: IdentityViewProps['fmtEpoch'] }) {
  return (
    <ConsolePanel divided title="Principals">
      {vm.isPrincipalsEmpty ? (
        <p className="text-(--ui-text-tertiary)" data-testid="console-principals-empty">
          no principals
        </p>
      ) : (
        <ConsoleRows testId="console-principals">
          {vm.principals.map(principal => (
            <li
              className="flex min-h-14 items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) py-2 last:border-b-0"
              key={principal.principalId}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-(--ui-text-primary)">{principal.name}</div>
                <div className="text-(--ui-text-tertiary)">
                  <span data-ec-mono="">{principal.displayRole}</span> · seen {fmtEpoch(principal.lastSeenTs)}
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-(--ui-text-secondary)">
                <StatusDot tone={principal.tone} />
                {principal.status}
              </span>
            </li>
          ))}
        </ConsoleRows>
      )}
    </ConsolePanel>
  )
}

function ChannelBindingsPanel({
  vm,
  fmtIso,
  onCreateBinding,
  onRevokeBinding,
}: {
  vm: IdentityViewModel
  fmtIso: IdentityViewProps['fmtIso']
  onCreateBinding: IdentityViewProps['onCreateBinding']
  onRevokeBinding: IdentityViewProps['onRevokeBinding']
}) {
  return (
    <ConsolePanel
      action={<CreateBindingForm vm={vm} onCreateBinding={onCreateBinding} />}
      divided
      title="Channel bindings"
    >
      {vm.isBindingsEmpty ? (
        <p className="text-(--ui-text-tertiary)" data-testid="console-channel-bindings-empty">
          no channel bindings
        </p>
      ) : (
        <ConsoleRows testId="console-channel-bindings">
          {vm.bindings.map(binding => (
            <li
              className="flex min-h-14 items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) py-2 last:border-b-0"
              key={binding.bindingId}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-(--ui-text-primary)">
                  {binding.channel} · {binding.externalSubject}
                </div>
                <div className="text-(--ui-text-tertiary)">
                  <span data-ec-mono="">{binding.principalId}</span> · v{binding.version} · {fmtIso(binding.updatedTs)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex items-center gap-1 text-(--ui-text-secondary)">
                  <StatusDot tone={binding.tone} />
                  {binding.status}
                </span>
                {binding.canRevoke ? (
                  <ConfirmAction
                    description="This revokes the binding on the server."
                    destructive
                    invalidateKey={['enterprise-console', 'channel-bindings']}
                    permission="channel.binding.manage"
                    run={() => onRevokeBinding(binding.bindingId)}
                    testId={`console-binding-revoke-${binding.bindingId}`}
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
    </ConsolePanel>
  )
}

export function IdentityView({ vm, onCreateBinding, onRevokeBinding, fmtEpoch, fmtIso }: IdentityViewProps) {
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
        <PrincipalsPanel fmtEpoch={fmtEpoch} vm={vm} />
        {vm.canManageBindings ? (
          <ChannelBindingsPanel
            fmtIso={fmtIso}
            onCreateBinding={onCreateBinding}
            onRevokeBinding={onRevokeBinding}
            vm={vm}
          />
        ) : null}
      </div>
    </div>
  )
}