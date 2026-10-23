import { useCallback, useEffect, useRef, useState } from 'react'

import type { LocalTextReply, LocalTextRequest } from '../../electron/enterprise-local-text-types'
import type { EnterpriseClientRuntime } from './runtime'

/** Presentation of main-owned connection facts; only a click starts OAuth. */
export function useLocalTextConnection(runtime: EnterpriseClientRuntime | null) {
  const [state, setState] = useState<LocalTextReply>({ state: 'unavailable', reason: 'LOCAL_TEXT_RUNTIME_UNAVAILABLE' })
  const [authUrl, setAuthUrl] = useState('')
  const revision = useRef(0)
  const modelCheck = useRef<number | null>(null)
  const refresh = useCallback(async () => {
    const expected = ++revision.current
    try {
      const reply = await runtime?.localText?.({ action: 'status' })
      if (reply && revision.current === expected) {setState(reply); if (reply.state !== 'connecting') {setAuthUrl('')}}
    } catch {if (revision.current === expected) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' }); setAuthUrl('')}}
  }, [runtime])
  useEffect(() => {
    let live = true
    const expected = ++revision.current
    modelCheck.current = null
    setAuthUrl('')
    setState({ state: 'unavailable', reason: 'LOCAL_TEXT_RUNTIME_UNAVAILABLE' })
    void runtime?.localText?.({ action: 'status' }).then(reply => {if (live && revision.current === expected) {setState(reply)}})
      .catch(() => {if (live && revision.current === expected) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' })}})
    return () => {live = false; revision.current += 1}
  }, [runtime])
  useEffect(() => {
    if (state.state !== 'connecting' && state.modelStatus !== 'checking') {return}
    let live = true
    let timer: number
    const poll = async () => {
      const expected = revision.current
      try {
        const reply = await runtime?.localText?.({ action: 'status' })
        if (live && reply && revision.current === expected) {
          setState(reply)
          if (reply.state === 'connecting' || reply.modelStatus === 'checking') {timer = window.setTimeout(() => void poll(), 2000)}
          else {setAuthUrl('')}
        }
      } catch {if (live && revision.current === expected) {setState({ state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' }); setAuthUrl('')}}
      finally {
        // A refresh can supersede an already pending poll without changing
        // the checking state. Keep one local-status poll alive in that case.
        if (live && revision.current !== expected) {timer = window.setTimeout(() => void poll(), 2000)}
      }
    }
    timer = window.setTimeout(() => void poll(), 2000)
    return () => {live = false; window.clearTimeout(timer)}
  }, [runtime, state.state, state.modelStatus])
  const command = useCallback(async (action: LocalTextRequest['action']) => {
    if (action === 'checkModel' && modelCheck.current !== null) {return}
    const expected = ++revision.current
    if (action === 'checkModel') {
      modelCheck.current = expected
      setState({ state: 'connected', modelStatus: 'checking', reason: 'LOCAL_TEXT_MODEL_CHECKING' })
    } else {
      modelCheck.current = null
      if (action === 'connect') {setState({ state: 'connecting' })}
      if (action === 'logout' || action === 'cancelLogin') {setState({ state: 'disconnected' })}
    }
    setAuthUrl('')
    try {
      const reply = await runtime?.localText?.({ action })
      if (reply && revision.current === expected) {setState(reply); setAuthUrl(reply.authUrl ?? '')}
    } catch {if (revision.current === expected) {setState(action === 'checkModel'
      ? { state: 'connected', modelStatus: 'unconfirmed', reason: 'LOCAL_TEXT_MODEL_CHECK_FAILED' }
      : { state: 'unavailable', reason: 'LOCAL_TEXT_UNAVAILABLE' }); setAuthUrl('')}}
    finally {if (modelCheck.current === expected) {modelCheck.current = null}}
  }, [runtime])
  return { state, authUrl, refresh, command }
}
