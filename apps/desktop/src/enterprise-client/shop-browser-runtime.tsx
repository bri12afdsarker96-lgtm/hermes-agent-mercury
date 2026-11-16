import { useCallback, useEffect, useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { shopBrowserRuntimeCopy } from '@/i18n/shop-browser-runtime'

import type { ShopBrowserRuntimeRequest, ShopBrowserRuntimeSnapshot } from '../../electron/shop-browser-runtime-types'

import type { EnterpriseClientRuntime } from './runtime'

export function ShopBrowserRuntimeSettings({
  runtime,
  onClosed
}: {
  runtime: EnterpriseClientRuntime
  onClosed?: () => void
}) {
  const { locale } = useI18n()
  const copy = shopBrowserRuntimeCopy[locale]
  const inputId = useId()
  const [snapshot, setSnapshot] = useState<ShopBrowserRuntimeSnapshot>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lifecycle = useMemo(() => ({ runtime, alive: true, busy: false, editing: false }), [runtime])

  const request = useCallback(
    async (command: Omit<ShopBrowserRuntimeRequest, 'sessionId'>) => {
      if (!lifecycle.runtime.shopBrowserRuntime || lifecycle.busy) {
        return
      }

      lifecycle.busy = true
      setBusy(true)

      try {
        const reply = await lifecycle.runtime.shopBrowserRuntime(command)

        if (!lifecycle.alive) {
          return
        }

        if (!reply.ok || !reply.snapshot) {
          throw new Error(reply.error || 'SHOP_BROWSER_RUNTIME_FAILED')
        }

        setSnapshot(reply.snapshot)

        if (!lifecycle.editing) {
          setDraft(String(reply.snapshot.maxConcurrentBrowsers))
        }

        setError('')

        if (command.action === 'closeAll') {
          onClosed?.()
        }
      } catch (reason) {
        if (lifecycle.alive) {
          setError(reason instanceof Error ? reason.message : 'SHOP_BROWSER_RUNTIME_FAILED')
          setSnapshot(undefined)
        }
      } finally {
        lifecycle.busy = false

        if (lifecycle.alive) {
          setBusy(false)
        }
      }
    },
    [lifecycle, onClosed]
  )

  useEffect(() => {
    lifecycle.alive = true
    setSnapshot(undefined)
    setDraft('')
    setError('')
    void request({ action: 'snapshot' })

    const timer = setInterval(() => {
      if (!lifecycle.editing) {
        void request({ action: 'snapshot' })
      }
    }, 10000)

    return () => {
      lifecycle.alive = false
      clearInterval(timer)
    }
  }, [runtime, lifecycle, request])

  if (!runtime.shopBrowserRuntime) {
    return null
  }

  return (
    <div className="cs-browser-runtime" title={copy.browserOnly}>
      <label htmlFor={inputId}>{copy.limit}</label>
      <Input
        disabled={busy || !snapshot}
        id={inputId}
        max={10}
        min={1}
        onBlur={() => {
          lifecycle.editing = false
          const text = draft.trim()
          const parsed = Number(text)

          const valid =
            /^[+-]?\d+$/.test(text) && Number.isInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647

          const value = valid ? parsed : 3
          const limit = Math.max(1, Math.min(10, value))
          setDraft(String(limit))

          if (limit !== snapshot?.maxConcurrentBrowsers) {
            void request({ action: 'setLimit', maxConcurrentBrowsers: limit })
          }
        }}
        onChange={event => setDraft(event.target.value)}
        onFocus={() => {
          lifecycle.editing = true
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
        step={1}
        type="number"
        value={draft}
      />
      <span role="status">
        {copy.retained} {snapshot ? `${snapshot.browsers.length}/${snapshot.maxConcurrentBrowsers}` : '—'}
      </span>
      <Button
        disabled={busy || !snapshot?.browsers.length}
        onClick={() => void request({ action: 'closeAll' })}
        variant="secondary"
      >
        {copy.closeAll}
      </Button>
      <span className="cs-muted">{copy.browserOnly}</span>
      {error ? (
        <span className="cs-error" role="alert">
          {copy.failed} ({error})
        </span>
      ) : null}
    </div>
  )
}
