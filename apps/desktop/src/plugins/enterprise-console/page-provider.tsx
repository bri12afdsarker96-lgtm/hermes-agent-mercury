/**
 * Provider page — real `/api/providers`. The server never returns a key; we show
 * `configured` status only (never a secret value). Provider mutation authority
 * remains server-owned. Secret form state is erased whenever its dialog closes.
 */

import { Input, StatusDot, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { isSuperAdmin } from './capabilities'
import { ConsoleRows, QueryBody, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { PageStatusBadge } from './status-badge'
import { useTransport } from './transport'
import { ConsolePanel, PageHeader } from './ui'

interface ProviderRow {
  api_key_env: null | string
  configured: boolean
  default_model: string
  key: string
  kind: string
  label: string
}

interface ProvidersResp {
  active: null | string
  providers: ProviderRow[]
}

const PROVIDERS_KEY = ['enterprise-console', 'providers'] as const

function SetKeyAction({ label, providerKey }: { label: string; providerKey: string }) {
  const transport = useTransport()
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')

  const clearSensitiveState = () => {
    setApiKey('')
    setBaseUrl('')
    setModel('')
  }

  return (
    <FormAction
      canSubmit={apiKey.length > 0}
      invalidateKey={PROVIDERS_KEY}
      onOpenChange={open => {
        if (!open) {
          clearSensitiveState()
        }
      }}
      permission="provider.set_key"
      submit={() =>
        transport.post('/api/set-provider-key', {
          api_key: apiKey,
          base_url: baseUrl || undefined,
          model: model || undefined,
          provider: providerKey
        })
      }
      submitLabel="Save"
      testId={`console-provider-setkey-${providerKey}`}
      title={`Set key for ${label}`}
      trigger="set key"
    >
      <Input
        autoComplete="off"
        data-testid={`console-provider-apikey-${providerKey}`}
        onChange={event => setApiKey(event.target.value)}
        placeholder="api key"
        type="password"
        value={apiKey}
      />
      <Input onChange={event => setBaseUrl(event.target.value)} placeholder="base url (optional)" value={baseUrl} />
      <Input onChange={event => setModel(event.target.value)} placeholder="model (optional)" value={model} />
    </FormAction>
  )
}

export function ProviderPage() {
  const transport = useTransport()
  const canManage = isSuperAdmin(useValue($whoami))
  const query = useConsoleQuery<ProvidersResp>(PROVIDERS_KEY, '/api/providers')

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-provider"
    >
      <PageHeader
        purpose="Inspect provider readiness and, for super administrators, update server-owned provider configuration."
        status={<PageStatusBadge status="ready" />}
        title="Providers"
      />

      <ConsolePanel divided title="Provider configuration">
        <QueryBody emptyText="no providers" isEmpty={data => data.providers.length === 0} query={query}>
          {data => (
            <ConsoleRows testId="console-providers">
              {data.providers.map(provider => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  data-active={provider.key === data.active}
                  key={provider.key}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-(--ui-text-primary)">
                      {provider.label}
                      {provider.key === data.active ? <span className="ml-2 text-xs text-primary">active</span> : null}
                    </div>
                    <div className="text-(--ui-text-tertiary)">
                      {provider.kind} · {provider.default_model}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <StatusDot tone={provider.configured ? 'good' : 'muted'} />
                      {provider.configured ? 'configured' : 'not configured'}
                    </span>
                    {canManage ? <SetKeyAction label={provider.label} providerKey={provider.key} /> : null}
                    {canManage && provider.key !== data.active ? (
                      <ConfirmAction
                        invalidateKey={PROVIDERS_KEY}
                        permission="provider.set"
                        run={() => transport.post('/api/select-provider', { key: provider.key })}
                        testId={`console-provider-select-${provider.key}`}
                        title={`Switch active provider to ${provider.label}?`}
                      >
                        set active
                      </ConfirmAction>
                    ) : null}
                  </div>
                </li>
              ))}
            </ConsoleRows>
          )}
        </QueryBody>
      </ConsolePanel>
    </div>
  )
}
