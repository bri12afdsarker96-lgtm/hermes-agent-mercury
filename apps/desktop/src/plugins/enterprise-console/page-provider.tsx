/**
 * Provider page — real `/api/providers` (read-only). The server never returns a
 * key; we show `configured` status only (never a secret value).
 */

import { StatusDot } from '@hermes/plugin-sdk'

import { ConsoleRows, QueryBody, useConsoleQuery } from './page-kit'

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

export function ProviderPage() {
  const query = useConsoleQuery<ProvidersResp>(['enterprise-console', 'providers'], '/api/providers')

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
                <span className="inline-flex shrink-0 items-center gap-1 text-xs">
                  <StatusDot tone={provider.configured ? 'good' : 'muted'} />
                  {provider.configured ? 'configured' : 'not configured'}
                </span>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}
