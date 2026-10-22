import { useCallback, useEffect, useState } from 'react'

import type { LocalTextReply, LocalTextRequest } from '../../electron/enterprise-local-text-types'
import type { EnterpriseClientRuntime } from './runtime'

/** Presentation of main-owned connection facts; only a click starts OAuth. */
export function useLocalTextConnection(runtime: EnterpriseClientRuntime | null) {
  const [state, setState] = useState<LocalTextReply>({ state: 'unavailable', reason: 'LOCAL_TEXT_RUNTIME_UNAVAILABLE' })
  const [authUrl, setAuthUrl] = useState('')
  const refresh = useCallback(async () => {
    try {
      const reply = await runtime?.localText?.({ action: 'status' })
      if (reply) {setState(reply)}
    } catch {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' })}
  }, [runtime])
  useEffect(() => {
    let live = true
    setAuthUrl('')
    setState({ state: 'unavailable', reason: 'LOCAL_TEXT_RUNTIME_UNAVAILABLE' })
    void runtime?.localText?.({ action: 'status' }).then(reply => {if (live) {setState(reply)}})
      .catch(() => {if (live) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' })}})
    return () => {live = false}
  }, [runtime])
  useEffect(() => {
    if (state.state !== 'connecting') {return}
    let live = true
    let timer: number
    const poll = async () => {
      try {
        const reply = await runtime?.localText?.({ action: 'status' })
        if (live && reply) {
          setState(reply)
          if (reply.state === 'connecting') {timer = window.setTimeout(() => void poll(), 2000)}
          else {setAuthUrl('')}
        }
      } catch {if (live) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' })}}
    }
    timer = window.setTimeout(() => void poll(), 2000)
    return () => {live = false; window.clearTimeout(timer)}
  }, [runtime, state.state])
  const command = useCallback(async (action: LocalTextRequest['action']) => {
    if (action === 'connect') {setState({ state: 'connecting' })}
    try {
      const reply = await runtime?.localText?.({ action })
      if (reply) {setState(reply); setAuthUrl(reply.authUrl ?? '')}
    } catch {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' }); setAuthUrl('')}
  }, [runtime])
  return { state, authUrl, refresh, command }
}
