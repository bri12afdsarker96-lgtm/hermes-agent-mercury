import { useEffect, useState } from 'react'

import { Loader } from '@/components/ui/loader'

import type { DoudianReply } from '../../electron/doudian-types'

import { useDoudianEntryCopy } from './doudian-entry-copy'
import type { EnterpriseClientRuntime } from './runtime'

export interface DoudianPageProps {
  runtime: EnterpriseClientRuntime | null
}
export type EntryState = 'checking' | 'host-missing' | 'unauthorized' | 'idle'
export const authorizationErrors = ['DOUDIAN_FORBIDDEN', 'DOUDIAN_OWNER_CHANGED', 'LICENSE_REQUIRED']

export function capabilityState(reply: DoudianReply): EntryState {
  if (!reply.ok) {return authorizationErrors.includes(reply.error ?? '') ? 'unauthorized' : 'host-missing'}

  if (!reply.capabilities || reply.capabilities.protocol !== 1 || typeof reply.capabilities.authorized !== 'boolean')
    {return 'host-missing'}

  return reply.capabilities.authorized ? 'idle' : 'unauthorized'
}

export function useDoudianEntryState(runtime: EnterpriseClientRuntime | null) {
  const copy = useDoudianEntryCopy()
  const [result, setResult] = useState<{ owner: EnterpriseClientRuntime; state: EntryState; reason: string }>()
  useEffect(() => {
    let alive = true

    if (runtime?.doudian) {
      void (async () => {
        try {
          const reply = await runtime.doudian!({ action: 'capabilities' })
          const state = capabilityState(reply)

          if (alive)
            {setResult({
              owner: runtime,
              state,
              reason: reply.error ?? (state === 'host-missing' ? 'DOUDIAN_PROTOCOL_ERROR' : '')
            })}
        } catch {
          if (alive) {setResult({ owner: runtime, state: 'host-missing', reason: 'DOUDIAN_HOST_LOST' })}
        }
      })()
    }

    return () => {
      alive = false
    }
  }, [runtime])

  if (!runtime) {return { state: 'unauthorized' as const, reason: copy.noRuntime }}

  if (!runtime.doudian) {return { state: 'host-missing' as const, reason: copy.noBridge }}

  if (result?.owner !== runtime) {return { state: 'checking' as const, reason: '' }}

  return result
}

export function DoudianEntryStatus({ state, reason = '' }: { state: EntryState; reason?: string }) {
  const copy = useDoudianEntryCopy()

  const label =
    state === 'host-missing'
      ? copy.missing
      : state === 'unauthorized'
        ? copy.unauthorized
        : state === 'checking'
          ? copy.checking
          : copy.idle

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-(--ui-stroke-tertiary) py-3"
      data-state={state}
      role="status"
    >
      {state === 'checking' ? <Loader /> : null}
      <strong>{label}</strong>
      {reason ? <span className="break-words">{reason}</span> : null}
    </div>
  )
}
