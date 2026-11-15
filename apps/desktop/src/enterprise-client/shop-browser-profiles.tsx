import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { shopBrowserCopy } from '@/i18n/shop-browser'

import type { ShopBrowserProfile, ShopBrowserRequest } from '../../electron/shop-browser-types'
import type { EnterpriseClientRuntime } from './runtime'

export function ShopBrowserProfilesPanel({ runtime }: { runtime: EnterpriseClientRuntime }) {
  const { locale } = useI18n()
  const copy = shopBrowserCopy[locale]
  const [profiles, setProfiles] = useState<ShopBrowserProfile[]>([])
  const [selected, setSelected] = useState('')
  const [opened, setOpened] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<'relogin' | 'delete' | null>(null)
  const slot = useRef<HTMLDivElement>(null)
  const lifecycle = useMemo(() => ({ alive: true, busy: false }), [runtime])
  const selectedProfile = profiles.find(profile => profile.id === selected)

  const refresh = useCallback(async () => {
    const reply = await runtime.shopBrowser!({ action: 'list' })
    if (!lifecycle.alive) return
    if (!reply.ok) {
      setOpened(null)
      throw new Error(reply.error)
    }
    setProfiles(reply.profiles ?? [])
    setOpened(reply.openProfileId ?? null)
  }, [runtime, lifecycle])
  const run = useCallback(
    async (operation: () => Promise<void>) => {
      if (lifecycle.busy) return
      lifecycle.busy = true
      setBusy(true)
      setError('')
      try {
        await operation()
      } catch (reason) {
        if (lifecycle.alive) {
          setError(reason instanceof Error ? reason.message : 'SHOP_PROFILE_FAILED')
          setOpened(null)
        }
      } finally {
        lifecycle.busy = false
        if (lifecycle.alive) setBusy(false)
      }
    },
    [lifecycle]
  )

  useEffect(() => {
    lifecycle.alive = true
    setProfiles([])
    setSelected('')
    setOpened(null)
    setConfirmation(null)
    void run(refresh)
    return () => {
      lifecycle.alive = false
      void runtime.shopBrowser!({ action: 'close' }).catch(() => {})
    }
  }, [runtime, lifecycle, refresh, run])

  useEffect(() => {
    if (!opened) return
    const timer = setInterval(() => {
      if (!lifecycle.busy) void run(refresh)
    }, 10000)
    return () => clearInterval(timer)
  }, [opened, refresh, run, lifecycle])

  const bounds = () => {
    const rectangle = slot.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.round(rectangle.x)),
      y: Math.max(0, Math.round(rectangle.y)),
      width: Math.round(rectangle.width),
      height: Math.round(rectangle.height)
    }
  }
  useEffect(() => {
    if (!opened || !slot.current) return
    const resize = () => {
      void runtime.shopBrowser!({ action: 'bounds', profileId: opened, bounds: bounds() })
        .then(reply => {
          if (!reply.ok && lifecycle.alive) {
            setOpened(null)
            setError(reply.error ?? 'SHOP_PROFILE_FAILED')
          }
        })
        .catch(() => {
          if (lifecycle.alive) setOpened(null)
        })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(slot.current)
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', resize, true)
    resize()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', resize, true)
    }
  }, [opened, runtime, lifecycle])

  const invoke = (request: Omit<ShopBrowserRequest, 'sessionId'>) =>
    void run(async () => {
      const reply = await runtime.shopBrowser!(request)
      if (!reply.ok) throw new Error(reply.error)
      if (!lifecycle.alive) return
      if (reply.profile) setSelected(request.action === 'delete' ? '' : reply.profile.id)
      setConfirmation(null)
      await refresh()
    })
  const open = (target: 'merchant' | 'feige') =>
    invoke({ action: 'open', profileId: selected, target, bounds: bounds() })
  const confirm = (action: 'relogin' | 'delete') =>
    void run(async () => {
      const reply = await runtime.shopBrowser!({ action: 'close' })
      if (!reply.ok) throw new Error(reply.error)
      if (lifecycle.alive) {
        setOpened(null)
        setConfirmation(action)
      }
    })

  return (
    <section className="space-y-3" aria-label={copy.title}>
      <h3>{copy.title}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => invoke({ action: 'create' })} variant="secondary">
          {copy.create}
        </Button>
        <Button disabled={busy} onClick={() => void run(refresh)} variant="secondary">
          {copy.refresh}
        </Button>
        {busy ? <span role="status">{copy.pending}</span> : null}
      </div>
      {error ? (
        <p role="alert">
          {copy.failed} ({error})
        </p>
      ) : null}
      {profiles.length ? (
        <label>
          {copy.profile}
          <select
            value={selected}
            disabled={busy || !!opened}
            onChange={event => {
              setSelected(event.target.value)
              setConfirmation(null)
            }}
          >
            <option value="">—</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.displayName} {profile.shopId ?? ''}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>{copy.empty}</p>
      )}
      {selectedProfile ? (
        <>
          <p role="status">
            {copy[selectedProfile.loginState]} {selectedProfile.shopName ?? ''} {selectedProfile.checkedAt ?? ''}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => open('merchant')} variant="secondary">
              {copy.merchant}
            </Button>
            <Button disabled={busy} onClick={() => open('feige')} variant="secondary">
              {copy.feige}
            </Button>
            <Button
              disabled={busy || opened !== selected}
              onClick={() => invoke({ action: 'identify', profileId: selected })}
              variant="secondary"
            >
              {copy.identify}
            </Button>
            <Button disabled={busy || !opened} onClick={() => invoke({ action: 'close' })} variant="secondary">
              {copy.close}
            </Button>
            <Button disabled={busy} onClick={() => confirm('relogin')} variant="secondary">
              {copy.relogin}
            </Button>
            <Button disabled={busy} onClick={() => confirm('delete')} variant="secondary">
              {copy.remove}
            </Button>
          </div>
          {confirmation ? (
            <div role="alert">
              <p>{confirmation === 'delete' ? copy.deleteWarning : copy.resetWarning}</p>
              <Button disabled={busy} onClick={() => invoke({ action: confirmation, profileId: selected })}>
                {confirmation === 'delete' ? copy.confirmDelete : copy.confirmReset}
              </Button>
              <Button disabled={busy} onClick={() => setConfirmation(null)} variant="secondary">
                {copy.cancel}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      <div ref={slot} aria-label={copy.browser} className="w-full" style={{ height: opened ? 600 : 0 }} />
    </section>
  )
}
