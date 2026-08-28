/**
 * Provider page — real `/api/providers` (read-only). The server never returns a
 * key; we show `configured` status only (never a secret value).
 */

import { Input, StatusDot, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { isSuperAdmin } from './capabilities'
import { ConsoleRows, QueryBody, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { useTransport } from './transport'

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

  return (
    <FormAction
      canSubmit={apiKey.length > 0}
      invalidateKey={PROVIDERS_KEY}
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
      {/* Password field: the secret is never displayed and never logged. */}
      <Input
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
    <div data-page-status="ready" data-testid="console-page-provider">
      <QueryBody emptyText="no providers" isEmpty={data => data.providers.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-providers">
            {data.providers.map(provider => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                data-active={provider.key === data.active}
                key={provider.key}
              >
                <div className="min-w-0">
                  <div className="truncate">
                    {provider.label}
                    {provider.key === data.active ? <span className="ml-2 text-xs text-primary">active</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {provider.kind} · {provider.default_model}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
    </div>
  )
}
