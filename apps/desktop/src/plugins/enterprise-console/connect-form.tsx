/**
 * Connect form — points the console at a Hermes server and authenticates with a
 * principal bearer. The bearer lives only in this component's local state and
 * the in-memory `$token` atom; it is never persisted or logged. The base URL
 * (not a secret) is remembered.
 */

import { Button, Input, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { type FormEvent, useState } from 'react'

import { $baseUrl, $connectError, $connecting, connect } from './session'

export function ConnectForm() {
  const t = usePluginI18n('enterprise-console')
  const savedBaseUrl = useValue($baseUrl)
  const connecting = useValue($connecting)
  const error = useValue($connectError)
  const [baseUrl, setBaseUrl] = useState(savedBaseUrl)
  const [token, setToken] = useState('')

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const bearer = token

    if (!baseUrl.trim() || !bearer || connecting) {
      return
    }

    // Hand the credential off and clear the renderer input immediately — the
    // bearer belongs to the transport (the main process, for the production
    // adapter), not this form. Rejection is surfaced via $connectError.
    setToken('')
    void connect(baseUrl, bearer).catch(() => undefined)
  }

  return (
    <form
      className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-3"
      data-testid="console-connect"
      onSubmit={onSubmit}
    >
      <div>
        <div className="text-sm font-medium">{t('connect.title')}</div>
        <div className="mt-1 text-xs text-muted-foreground">{t('connect.intro')}</div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('connect.baseUrl')}
        <Input
          autoComplete="off"
          onChange={event => setBaseUrl(event.target.value)}
          placeholder={t('connect.baseUrlPlaceholder')}
          value={baseUrl}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('connect.token')}
        <Input
          autoComplete="off"
          onChange={event => setToken(event.target.value)}
          placeholder={t('connect.tokenPlaceholder')}
          type="password"
          value={token}
        />
      </label>

      {error ? (
        <div className="text-xs text-destructive" data-testid="console-connect-error">
          {error}
        </div>
      ) : null}

      <Button data-testid="console-connect-submit" disabled={connecting} type="submit">
        {connecting ? t('connect.connecting') : t('connect.connect')}
      </Button>
    </form>
  )
}
