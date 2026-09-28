import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Button } from '@/components/ui/button'
import { $enterprisePackageInstallFrozen } from './enterprise-install-readiness'
import { useDeliveryCopy } from './delivery-copy'
import { useDeliveryWork } from './use-delivery-work'
import type { EnterpriseClientRuntime } from './runtime'

interface Policy {
  my_on_duty?: boolean
  my_auto_reply_enabled?: boolean
}
export function WeComDutyPanel({ runtime, role }: { runtime: EnterpriseClientRuntime; role: string }) {
  const copy = useDeliveryCopy()
  const frozen = useStore($enterprisePackageInstallFrozen)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const locked = useRef(false)
  const revision = useRef(0)
  useDeliveryWork(busy)
  const load = useCallback(
    async (preserveError = false) => {
      const request = ++revision.current
      try {
        const result = await runtime.get<Policy>('/api/wecom-policy')
        if (
          typeof result.my_on_duty !== 'boolean' ||
          (role === 'operator' && typeof result.my_auto_reply_enabled !== 'boolean')
        ) {
          throw new Error('invalid policy')
        }
        if (alive.current && request === revision.current) {
          setPolicy(result)
          if (!preserveError) {
            setError('')
          }
        }
      } catch {
        if (alive.current && request === revision.current) {
          setPolicy(null)
          setError(copy.failed)
        }
      }
    },
    [runtime, role, copy.failed]
  )
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
      ++revision.current
    }
  }, [load])
  const change = async (field: 'on_duty' | 'auto_reply_enabled', value: boolean) => {
    if (
      locked.current ||
      frozen ||
      !runtime.post ||
      !['supervisor', 'operator'].includes(role) ||
      (field === 'auto_reply_enabled' && role !== 'operator')
    ) {
      return
    }
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await runtime.post(field === 'on_duty' ? '/api/wecom-duty' : '/api/wecom-auto-reply', { [field]: value })
      await load()
    } catch {
      if (alive.current) {
        setError(copy.failed)
        await load(true)
      }
    } finally {
      locked.current = false
      if (alive.current) {
        setBusy(false)
      }
    }
  }
  return (
    <section className="hesc-card" aria-label={copy.duty}>
      <div className="hesc-panel-heading">
        <h2>{copy.duty}</h2>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
          {copy.refresh}
        </Button>
      </div>
      <p>{copy.dutyHint}</p>
      {error ? <p role="alert">{error}</p> : null}
      {policy && ['supervisor', 'operator'].includes(role) ? (
        <div className="hesc-voice-actions">
          <label>
            <input
              type="checkbox"
              checked={policy.my_on_duty === true}
              disabled={busy || frozen || !runtime.post}
              onChange={event => void change('on_duty', event.target.checked)}
            />
            {copy.onDuty}
          </label>
          {role === 'operator' ? (
            <label>
              <input
                type="checkbox"
                checked={policy.my_auto_reply_enabled === true}
                disabled={busy || frozen || !runtime.post}
                onChange={event => void change('auto_reply_enabled', event.target.checked)}
              />
              {copy.autoReply}
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
