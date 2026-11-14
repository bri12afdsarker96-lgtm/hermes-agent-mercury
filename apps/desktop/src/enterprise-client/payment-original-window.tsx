import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { doudianOriginalCopy } from '@/i18n/doudian-original'
import { paymentOriginalCopy } from '@/i18n/payment-original'
import { ExternalLink, RefreshCw, Square } from '@/lib/icons'

import type { DoudianTask } from '../../electron/doudian-types'

import type { EnterpriseClientRuntime } from './runtime'

type Capability = 'checking' | 'ready' | 'missing' | 'forbidden'
type Snapshot = { owner: EnterpriseClientRuntime; capability: Capability; task?: DoudianTask; error?: boolean }

export function OriginalPaymentWindow({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const { locale } = useI18n()
  const copy = paymentOriginalCopy[locale]
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [refresh, setRefresh] = useState(0)
  const [operation, setOperation] = useState<object | null>(null)
  const flight = useRef<object | null>(null)
  const revision = useRef(0)
  const owner = useRef(runtime)
  owner.current = runtime
  const current = snapshot?.owner === runtime ? snapshot : undefined
  const capability: Capability = !runtime ? 'forbidden' : !runtime.doudian ? 'missing' : current?.capability ?? 'checking'
  const task = current?.task
  const active = task?.kind === 'payment-window' && ['running', 'stopping', 'unknown'].includes(task.state)

  // Reset in-flight operation ownership when the session changes.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    revision.current++
    flight.current = null
    setOperation(null)
  }, [runtime])

  useEffect(() => {
    let disposed = false

    if (!runtime?.doudian) {return}
    setSnapshot(previous => ({
      ...(previous?.owner === runtime ? previous : {}), owner: runtime, capability: 'checking'
    }))
    void runtime.doudian({ action: 'capabilities' }).then(result => {
      if (disposed) {return}
      const ready = result.ok && result.capabilities?.protocol === 1 && result.capabilities.paymentUi === 1
      const denied = ['DOUDIAN_FORBIDDEN', 'DOUDIAN_OWNER_CHANGED'].includes(result.error ?? '')
      setSnapshot(previous => previous?.owner === runtime
        ? { ...previous, capability: ready ? 'ready' : denied ? 'forbidden' : 'missing' }
        : previous)
    }).catch(() => {
      if (!disposed) {setSnapshot(previous => previous?.owner === runtime ? { ...previous, capability: 'missing' } : previous)}
    })

    return () => { disposed = true }
  }, [runtime, refresh])

  useEffect(() => {
    if (!runtime?.doudian || capability !== 'ready') {return}
    let disposed = false
    let polling = false

    const poll = async () => {
      if (polling || flight.current) {return}
      polling = true
      const observedRevision = revision.current

      try {
        const result = await runtime.doudian!({ action: 'status' })

        if (!disposed && observedRevision === revision.current && result.ok && result.task?.kind === 'payment-window') {
          setSnapshot(previous => previous?.owner === runtime ? { ...previous, task: result.task } : previous)
        }
      } catch {
        // The original window retains its own stop control if status polling fails.
      } finally {
        polling = false
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), 1500)

    return () => { disposed = true; clearInterval(timer) }
  }, [runtime, capability])

  async function operate(action: 'openPayment' | 'stop') {
    if (!runtime?.doudian || flight.current || capability !== 'ready' || (action === 'stop' && !task?.taskId)) {return}
    const ticket = {}
    flight.current = ticket
    revision.current++
    setOperation(ticket)
    setSnapshot(previous => previous?.owner === runtime ? { ...previous, error: false } : previous)

    try {
      const result = await runtime.doudian(action === 'stop' ? { action, taskId: task!.taskId! } : { action })

      if (owner.current === runtime && flight.current === ticket) {
        setSnapshot(previous => previous?.owner === runtime
          ? { ...previous, task: result.ok && result.task?.kind === 'payment-window' ? result.task : previous.task,
              error: !result.ok || result.task?.kind !== 'payment-window' }
          : previous)
      }
    } catch {
      if (owner.current === runtime && flight.current === ticket)
        {setSnapshot(previous => previous?.owner === runtime ? { ...previous, error: true } : previous)}
    } finally {
      if (flight.current === ticket) {flight.current = null}
      setOperation(previous => previous === ticket ? null : previous)
    }
  }

  return (
    <section aria-label={copy.title} className="space-y-3 border-t border-border pt-4">
      <h2 className="text-base font-semibold">{copy.title}</h2>
      <p className="text-sm">{copy.modes}</p>
      <p className="text-sm text-muted-foreground">{copy.license}</p>
      <p className="text-sm">{capability === 'forbidden' ? doudianOriginalCopy[locale].forbidden : copy[capability]}</p>
      <div className="flex flex-wrap gap-2">
        {runtime?.doudian && capability !== 'forbidden' && (
          <Button disabled={!!operation || active || capability !== 'ready'} onClick={() => void operate('openPayment')}>
            <ExternalLink />
            {copy.open}
          </Button>
        )}
        {runtime?.doudian && capability === 'missing' && (
          <Button onClick={() => setRefresh(value => value + 1)} variant="outline">
            <RefreshCw />
            {copy.retry}
          </Button>
        )}
        {active && runtime?.doudian && (
          <Button disabled={!!operation || task?.state === 'stopping'} onClick={() => void operate('stop')} variant="outline">
            <Square />
            {copy.stop}
          </Button>
        )}
      </div>
      {task?.kind === 'payment-window' && (
        <p aria-live="polite" className="text-sm">
          {task.state === 'stopping' ? copy.stopping : active ? copy.opened : task.state === 'failed' ? copy.failed :
            task.state === 'paused_balance' ? copy.pausedBalance : task.state === 'paused_review' ? copy.pausedReview :
            task.state === 'completed' ? copy.completed : task.state === 'stopped' ? copy.stopped : copy.closed}
        </p>
      )}
      {current?.error && <p className="text-sm text-destructive" role="alert">{copy.failed}</p>}
    </section>
  )
}
