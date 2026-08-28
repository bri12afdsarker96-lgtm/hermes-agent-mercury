/**
 * Provider page — real `/api/providers` (read-only). The server never returns a
 * key; we show `configured` status only (never a secret value).
 */

import { StatusDot, useValue } from '@hermes/plugin-sdk'

import { ConfirmAction } from './actions'
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
                  {canManage && provider.key !== data.active ? (
                    <ConfirmAction
                      invalidateKey={PROVIDERS_KEY}
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
