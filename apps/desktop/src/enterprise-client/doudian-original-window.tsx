import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { doudianOriginalCopy } from '@/i18n/doudian-original'
import { ExternalLink, RefreshCw, Square } from '@/lib/icons'

import type { DoudianTask } from '../../electron/doudian-types'

import type { EnterpriseClientRuntime } from './runtime'

type Feature = 'review'
type Availability = 'checking' | 'ready' | 'missing' | 'forbidden'
const activeStates = ['running', 'stopping', 'unknown']

export function OriginalDoudianWindow({
  runtime,
  feature
}: {
  runtime: EnterpriseClientRuntime | null
  feature: Feature
}) {
  const { locale } = useI18n()
  const copy = doudianOriginalCopy[locale]

  const [result, setResult] = useState<{
    owner: EnterpriseClientRuntime | null
    feature: Feature
    availability: Availability
    task?: DoudianTask
    failed?: boolean
  }>()

  const [refresh, setRefresh] = useState(0)
  const [operation, setOperation] = useState<object | null>(null)
  const flight = useRef<object | null>(null)
  const busy = operation !== null
  const revision = useRef(0)
  const owner = useRef(runtime)
  owner.current = runtime
  const kind = `${feature}-window`
  const current = result?.owner === runtime && result.feature === feature ? result : undefined
  const availability = !runtime ? 'forbidden' : !runtime.doudian ? 'missing' : (current?.availability ?? 'checking')
  const task = current?.task
  const active = !!task && activeStates.includes(task.state)
  const ours = task?.kind === kind

  // Reset in-flight operation ownership when the session changes.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    revision.current++
    flight.current = null
    setOperation(null)
  }, [runtime, feature])

  useEffect(() => {
    let disposed = false

    if (!runtime?.doudian) {return}

    const updateAvailability = (availability: Availability) =>
      setResult(previous => ({
        ...(previous?.owner === runtime && previous.feature === feature ? previous : {}),
        owner: runtime,
        feature,
        availability
      }))

    updateAvailability('checking')
    void runtime
      .doudian({ action: 'capabilities' })
      .then(reply => {
        if (disposed) {return}
        const caps = reply.capabilities

        const available =
          reply.ok &&
          caps?.protocol === 1 &&
          caps.version === '1.0.54' &&
          caps.reviewUi === 1

        updateAvailability(
          available
            ? 'ready'
            : ['DOUDIAN_FORBIDDEN', 'DOUDIAN_OWNER_CHANGED'].includes(reply.error ?? '')
              ? 'forbidden'
              : 'missing'
        )
      })
      .catch(() => {
        if (!disposed) {updateAvailability('missing')}
      })

    return () => {
      disposed = true
    }
  }, [runtime, feature, refresh])

  useEffect(() => {
    if (!runtime?.doudian || availability !== 'ready') {return}

    let disposed = false,
      polling = false

    const poll = async () => {
      if (polling || flight.current) {return}
      polling = true
      const observedRevision = revision.current

      try {
        const reply = await runtime.doudian!({ action: 'status' })

        if (!disposed && observedRevision === revision.current)
          {setResult(previous =>
            previous?.owner === runtime && previous.feature === feature
              ? { ...previous, task: reply.ok ? reply.task : previous.task, failed: !reply.ok || !reply.task }
              : previous
          )}
      } catch {
        if (!disposed && observedRevision === revision.current)
          {setResult(previous => (previous ? { ...previous, failed: true } : previous))}
      } finally {
        polling = false
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), 1500)

    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [runtime, feature, availability])

  async function operate(stop: boolean) {
    if (!runtime?.doudian || flight.current || (stop && (!ours || !task?.taskId))) {return}
    const ticket = {}
    flight.current = ticket
    revision.current++
    setOperation(ticket)

    try {
      const reply = await runtime.doudian(
        stop ? { action: 'stop', taskId: task!.taskId! } : { action: 'openReview' }
      )

      if (owner.current === runtime && flight.current === ticket)
        {setResult(previous =>
          previous?.owner === runtime && previous.feature === feature
            ? {
                ...previous,
                task: reply.ok && reply.task?.kind === kind ? reply.task : previous.task,
                failed: !reply.ok || reply.task?.kind !== kind
              }
            : previous
        )}
    } catch {
      if (owner.current === runtime && flight.current === ticket)
        {setResult(previous => (previous ? { ...previous, failed: true } : previous))}
    } finally {
      if (flight.current === ticket) {flight.current = null}
      setOperation(previous => (previous === ticket ? null : previous))
    }
  }

  return (
    <section className="space-y-4" data-testid={`original-${feature}-window`}>
      <p>{copy.license}</p>
      <p data-state={availability} role="status">
        {copy[availability]}
      </p>
      {availability === 'ready' && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || active || current?.failed} onClick={() => void operate(false)}>
            <ExternalLink />
            {copy.openReview}
          </Button>
        </div>
      )}
      {active && ours && runtime?.doudian && (
        <Button disabled={busy || task?.state === 'stopping'} onClick={() => void operate(true)} variant="outline">
          <Square />
          {copy.stop}
        </Button>
      )}
      {(availability === 'missing' || current?.failed) && runtime?.doudian && (
        <Button onClick={() => setRefresh(value => value + 1)} variant="outline">
          <RefreshCw />
          {copy.retry}
        </Button>
      )}
      {active && !ours && <p>{copy.busy}</p>}
      {ours && (
        <p aria-live="polite">
          {task?.state === 'stopping'
            ? copy.stopping
            : task?.state === 'failed'
              ? copy.failed
              : active
                ? copy.opened
                : copy.closed}
        </p>
      )}
      {current?.failed && <p role="alert">{copy.failed}</p>}
    </section>
  )
}
