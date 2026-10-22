import { useCallback, useEffect, useRef, useState } from 'react'

import type { LocalTextReply, LocalTextRequest } from '../../electron/enterprise-local-text-types'
import type { EnterpriseClientRuntime } from './runtime'

/** Presentation of main-owned connection facts; only a click starts OAuth. */
export function useLocalTextConnection(runtime: EnterpriseClientRuntime | null) {
  const [state, setState] = useState<LocalTextReply>({ state: 'unavailable', reason: 'LOCAL_TEXT_RUNTIME_UNAVAILABLE' })
  const [authUrl, setAuthUrl] = useState('')
  const revision = useRef(0)
  const refresh = useCallback(async () => {
    const expected = revision.current
    try {
      const reply = await runtime?.localText?.({ action: 'status' })
      if (reply && revision.current === expected) {setState(reply); if (reply.state !== 'connecting') {setAuthUrl('')}}
    } catch {if (revision.current === expected) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' }); setAuthUrl('')}}
  }, [runtime])
  useEffect(() => {
    let live = true
    const expected = ++revision.current
    setAuthUrl('')
    setState({ state: 'unavailable', reason: 'LOCAL_TEXT_RUNTIME_UNAVAILABLE' })
    void runtime?.localText?.({ action: 'status' }).then(reply => {if (live && revision.current === expected) {setState(reply)}})
      .catch(() => {if (live && revision.current === expected) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' })}})
    return () => {live = false; revision.current += 1}
  }, [runtime])
  useEffect(() => {
    if (state.state !== 'connecting') {return}
    let live = true
    let timer: number
    const poll = async () => {
      const expected = revision.current
      try {
        const reply = await runtime?.localText?.({ action: 'status' })
        if (live && reply && revision.current === expected) {
          setState(reply)
          if (reply.state === 'connecting') {timer = window.setTimeout(() => void poll(), 2000)}
          else {setAuthUrl('')}
        }
      } catch {if (live && revision.current === expected) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' }); setAuthUrl('')}}
    }
    timer = window.setTimeout(() => void poll(), 2000)
    return () => {live = false; window.clearTimeout(timer)}
  }, [runtime, state.state])
  const command = useCallback(async (action: LocalTextRequest['action']) => {
    const expected = ++revision.current
    if (action === 'connect') {setState({ state: 'connecting' })}
    try {
      const reply = await runtime?.localText?.({ action })
      if (reply && revision.current === expected) {setState(reply); setAuthUrl(reply.authUrl ?? '')}
    } catch {if (revision.current === expected) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' }); setAuthUrl('')}}
  }, [runtime])
  return { state, authUrl, refresh, command }
}
