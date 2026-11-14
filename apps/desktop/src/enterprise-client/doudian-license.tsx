import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'

import type { EnterpriseClientRuntime } from './runtime'

export function DoudianLicense({ runtime, onReady }: { runtime: EnterpriseClientRuntime | null; onReady: () => void }) {
  const { locale } = useI18n()
  const zh = locale === 'zh' || locale === 'zh-hant'
  const [available, setAvailable] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [state, setState] = useState<'idle' | 'pending' | 'ready' | 'failed' | 'cache_unavailable'>('idle')
  const [code, setCode] = useState('')
  const revision = useRef(0)

  useEffect(() => {
    let alive = true
    revision.current++
    setAvailable(false)
    setAuthorized(false)
    setState('idle')
    setCode('')
    void runtime?.doudian?.({ action: 'capabilities' }).then(reply => {
      if (!alive) return
      setAvailable(reply.ok && reply.capabilities?.licenseActivation === 1)
      setAuthorized(reply.ok && reply.capabilities?.authorized === true && reply.capabilities.licenseVerification === 'verified-v1')
    }).catch(() => {})
    return () => { alive = false; revision.current++ }
  }, [runtime])

  useEffect(() => {
    if (state !== 'pending' || !runtime?.doudian) return
    let alive = true
    let inFlight = false
    const timer = setInterval(() => {
      if (inFlight) return
      inFlight = true
      void runtime.doudian!({ action: 'licenseStatus' }).then(async reply => {
        if (!alive) return
        if (!reply.ok || !reply.license) { setState('failed'); return }
        if (reply.license.state === 'ready') {
          const caps = await runtime.doudian!({ action: 'capabilities' })
          if (!alive) return
          if (caps.ok && caps.capabilities?.authorized === true && caps.capabilities.licenseVerification === 'verified-v1') {
            setState('ready')
            setAuthorized(true)
            onReady()
          } else setState('failed')
        } else if (reply.license.state === 'failed' || reply.license.state === 'cache_unavailable') setState(reply.license.state)
      }).catch(() => { if (alive) setState('failed') }).finally(() => { inFlight = false })
    }, 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [state, runtime, onReady])

  async function activate(resume = false) {
    if (!available || !runtime?.doudian || state === 'pending') return
    const value = code.trim()
    if (!resume && (value.length < 4 || value.length > 256)) return
    setCode('')
    setState('pending')
    const observed = revision.current
    try {
      const reply = await runtime.doudian(resume ? { action: 'resumeLicense' } : { action: 'activateLicense', licenseCode: value })
      if (observed === revision.current && (!reply.ok || reply.license?.state !== 'pending')) setState('failed')
    } catch { if (observed === revision.current) setState('failed') }
  }

  if (authorized) return null
  return <section aria-label={zh ? '原激活码授权' : 'Original activation'} className="flex flex-wrap items-end gap-3">
    {!available ? <p role="status">{zh ? '原激活码服务尚未就绪，无法执行任务。' : 'Activation service is not ready; tasks are unavailable.'}</p> : <>
      <label>{zh ? '原激活码' : 'Activation code'}<Input autoComplete="off" type="password" value={code} onChange={event => setCode(event.target.value)} /></label>
      <Button disabled={state === 'pending' || code.trim().length < 4} onClick={() => void activate()}>{zh ? '验证激活码' : 'Verify activation'}</Button>
      <Button disabled={state === 'pending'} variant="secondary" onClick={() => void activate(true)}>{zh ? '恢复本机授权' : 'Restore local activation'}</Button>
      {state === 'pending' && <span role="status">{zh ? '正在验证' : 'Verifying'}</span>}
      {state === 'failed' && <span role="alert">{zh ? '验证未完成，请检查授权服务后重试。' : 'Verification failed. Check the activation service and retry.'}</span>}
      {state === 'cache_unavailable' && <span role="status">{zh ? '本机没有可用授权缓存，请输入激活码。' : 'No usable local activation was found.'}</span>}
    </>}
  </section>
}
