import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { customerServiceCopy } from '@/i18n/customer-service'
import { customerServiceLayoutCopy } from '@/i18n/customer-service-layout'
import { nativeUiCopy } from '@/i18n/native-ui'
import { shopBrowserCopy } from '@/i18n/shop-browser'
import { shopBrowserRuntimeCopy } from '@/i18n/shop-browser-runtime'
import { shopCloudCopy } from '@/i18n/shop-cloud'

import type { ShopBrowserProfile, ShopBrowserReply, ShopBrowserRequest } from '../../electron/shop-browser-types'
import { recoverableShopBrowserErrors } from '../../electron/shop-browser-types'

import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserRuntimeSettings } from './shop-browser-runtime'
import { ShopBrowserWorkspacePanel } from './shop-browser-workspace'
import { ShopMailboxButton } from './shop-mailbox'
import { ShopPayoutSettingsButton } from './shop-payout-settings'
import { ShopServiceAssignment } from './shop-service-assignment'
import { ShopSharedAssignment } from './shop-shared-assignment'
import { ShopSubAccountsButton } from './shop-subaccounts'

export function ShopBrowserProfilesPanel({
  runtime,
  nativeLayout = false,
  selectedProfileId,
  onProfilesChange,
  onSelectedProfile,
  onOpenWorkflow,
  initialTarget
}: {
  runtime: EnterpriseClientRuntime
  nativeLayout?: boolean
  selectedProfileId?: string
  onProfilesChange?: (profiles: ShopBrowserProfile[]) => void
  onSelectedProfile?: (id: string) => void
  onOpenWorkflow?: () => void
  initialTarget?: 'feige'
}) {
  const { locale } = useI18n()
  const copy = shopBrowserCopy[locale]
  const layout = customerServiceLayoutCopy[locale]
  const native = nativeUiCopy[locale]
  const browserRuntime = shopBrowserRuntimeCopy[locale]
  const [profiles, setProfiles] = useState<ShopBrowserProfile[]>([])
  const [loaded, setLoaded] = useState(false)
  const [localSelected, setSelected] = useState('')
  const selected = selectedProfileId ?? localSelected
  const selection = useRef(selected)
  selection.current = selected
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [opened, setOpened] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cloud, setCloud] = useState<ShopBrowserReply['cloud']>()
  const [confirmation, setConfirmation] = useState<{ action: 'relogin' | 'delete'; profile: ShopBrowserProfile } | null>(null)
  const slot = useRef<HTMLDivElement>(null)
  const initialNavigation = useMemo(() => ({ target: initialTarget, opened: false }), [initialTarget])
  const lifecycle = useMemo(() => ({ runtime, alive: true, busy: false }), [runtime])
  const selectedProfile = profiles.find(profile => profile.id === selected)

  const refresh = useCallback(async () => {
    const reply = await lifecycle.runtime.shopBrowser!({ action: 'list' })

    if (!lifecycle.alive) {
      return
    }

    if (!reply.ok) {
      setLoaded(false)
      setCloud(undefined)
      setOpened(null)
      setProfiles([])
      setSelected('')
      onProfilesChange?.([])
      onSelectedProfile?.('')
      throw new Error(reply.error)
    }

    const available = reply.profiles ?? []
    setProfiles(available)
    setLoaded(true)

    if (selection.current && !available.some(profile => profile.id === selection.current)) {
      setSelected('')
      setConfirmation(null)
      onSelectedProfile?.('')
    }

    setCloud(reply.cloud)
    onProfilesChange?.(reply.profiles ?? [])
    setOpened(reply.openProfileId ?? null)
  }, [lifecycle, onProfilesChange, onSelectedProfile])

  const run = useCallback(
    async (operation: () => Promise<void>) => {
      if (lifecycle.busy) {
        return
      }

      lifecycle.busy = true
      setBusy(true)
      setError('')

      try {
        await operation()
      } catch (reason) {
        if (lifecycle.alive) {
          const code = reason instanceof Error ? reason.message : 'SHOP_PROFILE_FAILED'
          setError(code)

          if (!(recoverableShopBrowserErrors as readonly string[]).includes(code)) {
            setOpened(null)
          }

          if (/OWNER_CHANGED|ACCESS_UNAVAILABLE|FORBIDDEN/.test(code)) {
            setCloud(undefined)
            setProfiles([])
            setSelected('')
            setConfirmation(null)
            onProfilesChange?.([])
            onSelectedProfile?.('')
          }
        }
      } finally {
        lifecycle.busy = false

        if (lifecycle.alive) {
          setBusy(false)
        }
      }
    },
    [lifecycle, onProfilesChange, onSelectedProfile]
  )

  useEffect(() => {
    lifecycle.alive = true
    setProfiles([])
    setLoaded(false)
    setSelected('')
    setSearch('')
    setFilter('all')
    setOpened(null)
    setConfirmation(null)
    setCloud(undefined)
    void run(refresh)

    return () => {
      lifecycle.alive = false
      void runtime.shopBrowser!({ action: 'close' }).catch(() => {})
    }
  }, [runtime, lifecycle, refresh, run])

  useEffect(() => {
    if (!runtime.shopBrowser) {
      return
    }

    const timer = setInterval(() => {
      if (!lifecycle.busy) {
        void run(refresh)
      }
    }, 10000)

    return () => clearInterval(timer)
  }, [runtime, refresh, run, lifecycle])

  const bounds = useCallback(() => {
    const rectangle = slot.current!.getBoundingClientRect()
    let left = Math.max(0, rectangle.left)
    let top = Math.max(0, rectangle.top)
    let right = Math.min(window.innerWidth, rectangle.right)
    let bottom = Math.min(window.innerHeight, rectangle.bottom)

    for (let ancestor = slot.current!.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      const clip = ancestor.getBoundingClientRect()

      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, clip.left + ancestor.clientLeft)
        right = Math.min(right, clip.left + ancestor.clientLeft + ancestor.clientWidth)
      }

      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, clip.top + ancestor.clientTop)
        bottom = Math.min(bottom, clip.top + ancestor.clientTop + ancestor.clientHeight)
      }
    }

    const x = Math.max(0, Math.min(window.innerWidth, Math.round(left)))
    const y = Math.max(0, Math.min(window.innerHeight, Math.round(top)))

    return { x, y, width: Math.max(0, Math.floor(right - x)), height: Math.max(0, Math.floor(bottom - y)) }
  }, [])

  useEffect(() => {
    if (!opened || !slot.current) {
      return
    }

    const resize = () => {
      void runtime.shopBrowser!({ action: 'bounds', profileId: opened, bounds: bounds() })
        .then(reply => {
          if (!reply.ok && lifecycle.alive) {
            setOpened(null)
            setError(reply.error ?? 'SHOP_PROFILE_FAILED')
          }
        })
        .catch(() => {
          if (lifecycle.alive) {
            setOpened(null)
          }
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
  }, [opened, runtime, lifecycle, bounds])

  const invoke = useCallback(
    (request: Omit<ShopBrowserRequest, 'sessionId'>) =>
      void run(async () => {
        const reply = await runtime.shopBrowser!(request)

        if (!reply.ok) {
          if (request.action === 'open') {
            await refresh()
          }

          throw new Error(reply.error)
        }

        if (!lifecycle.alive) {
          return
        }

        if (reply.profile) {
          const id = request.action === 'delete' ? '' : reply.profile.id
          setSelected(id)
          onSelectedProfile?.(id)
        }

        setConfirmation(null)
        await refresh()

        if (reply.profile && (request.action === 'create' || request.action === 'relogin') && lifecycle.alive) {
          const opened = await runtime.shopBrowser!({
            action: 'open',
            profileId: reply.profile.id,
            target: 'merchant',
            bounds: bounds()
          })

          if (!lifecycle.alive) {
            return
          }

          await refresh()

          if (!opened.ok) {
            throw new Error(opened.error)
          }
        }
      }),
    [run, runtime, lifecycle, onSelectedProfile, refresh, bounds]
  )

  const open = useCallback(
    (target: 'merchant' | 'feige', profileId = selected) =>
      invoke({ action: 'open', profileId, target, bounds: bounds() }),
    [invoke, selected, bounds]
  )

  const browserClosed = useCallback(() => {
    setOpened(null)
    void run(refresh)
  }, [run, refresh])

  const exportShops = () =>
    void run(async () => {
      const reply = await runtime.shopBrowser!({ action: 'list' })

      if (!lifecycle.alive) {
        return
      }

      if (!reply.ok) {
        throw new Error(reply.error)
      }

      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`

      const rows = (reply.profiles ?? []).map(profile =>
        [profile.shopName || profile.displayName, profile.payoutSettings?.remitAmount ?? ''].map(quote).join(',')
      )

      const csv = '\uFEFF' + [native.csvShopName + ',' + native.amount, ...rows].join('\r\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `shops-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })

  const confirm = (action: 'relogin' | 'delete') =>
    void run(async () => {
      const profile = selectedProfile

      if (!profile) {return}
      const reply = await runtime.shopBrowser!({ action: 'close' })

      if (!reply.ok) {
        throw new Error(reply.error)
      }

      if (lifecycle.alive) {
        setOpened(null)
        setConfirmation({ action, profile })
      }
    })

  const confirmRowAction = (action: 'relogin' | 'delete', profile: ShopBrowserProfile) => {
    setConfirmation({ action, profile })
    setSelected(profile.id)
    onSelectedProfile?.(profile.id)
  }

  const submitConfirmation = () => {
    const pending = confirmation

    if (!pending) {return}
    void run(async () => {
      if (opened) {throw new Error('SHOP_PROFILE_IN_USE')}
      const current = profiles.find(profile => profile.id === pending.profile.id)

      if (!current || current.tenantId !== pending.profile.tenantId || current.principalId !== pending.profile.principalId || current.shopId !== pending.profile.shopId) {
        throw new Error('SHOP_PROFILE_NOT_FOUND')
      }

      // The runtime performs the final authorization and in-use checks.
      const result = await runtime.shopBrowser!({ action: pending.action, profileId: pending.profile.id })

      if (!result.ok) {throw new Error(result.error)}

      if (!lifecycle.alive) {return}

      if (result.profile && result.profile.id !== pending.profile.id) {
        throw new Error('SHOP_PROFILE_IDENTITY_CHANGED')
      }

      if (result.profile && (pending.action !== 'delete' || selection.current === pending.profile.id)) {
        const id = pending.action === 'delete' ? '' : result.profile.id
        setSelected(id)
        onSelectedProfile?.(id)
      }

      setConfirmation(null)
      await refresh()

      if (result.profile && pending.action === 'relogin' && lifecycle.alive) {
        const opened = await runtime.shopBrowser!({ action: 'open', profileId: result.profile.id, target: 'merchant', bounds: bounds() })

        if (!lifecycle.alive) {return}
        await refresh()

        if (!opened.ok) {throw new Error(opened.error)}
      }
    })
  }

  const openWorkspace = () =>
    void run(async () => {
      const reply = await runtime.shopBrowser!({ action: 'close' })

      if (!reply.ok) {
        throw new Error(reply.error)
      }

      if (lifecycle.alive) {
        setOpened(null)

        onOpenWorkflow?.()
      }
    })

  useEffect(() => {
    if (initialNavigation.target && selectedProfile && !busy && !initialNavigation.opened) {
      initialNavigation.opened = true
      open(initialNavigation.target)
    }
  }, [selectedProfile, busy, initialNavigation, open])

  if (nativeLayout) {
    return (
      <section aria-label={layout.shops} className="cs-native-page cs-shops" data-browser-open={!!opened}>
        <h2>{layout.shops}</h2>
        {cloud ? (
          <p data-testid="shop-cloud-status" role="status">
            {shopCloudCopy[locale][cloud.state]}
          </p>
        ) : null}
        <div className="cs-toolbar">
          <Button disabled={busy} onClick={() => invoke({ action: 'create' })}>
            {copy.create}
          </Button>
          <Button data-native-tone="info" disabled={busy} onClick={() => void run(refresh)} variant="secondary">
            {copy.refresh}
          </Button>
          <Button
            data-native-tone="success"
            disabled={busy || !profiles.length}
            onClick={exportShops}
            variant="secondary"
          >
            {native.export}
          </Button>
          <ShopMailboxButton disabled={busy || !!opened} runtime={runtime} />
          <select aria-label={native.shopFilter} onChange={event => setFilter(event.target.value)} value={filter}>
            <option value="all">{layout.all}</option>
            <option value="expired">{layout.loginLog}</option>
          </select>
          <Input
            aria-label={layout.searchShops}
            onChange={event => setSearch(event.target.value)}
            placeholder={layout.searchShops}
            value={search}
          />
          {busy ? <span role="status">{copy.pending}</span> : null}
        </div>
        {!opened ? <ShopBrowserRuntimeSettings onClosed={browserClosed} runtime={runtime} /> : null}
        <p className="cs-muted" id="shop-reception-service-unavailable">
          {browserRuntime.unavailableDetail}
        </p>
        {error ? (
          <p className="cs-error" role="alert">
            {copy.failed} ({error})
          </p>
        ) : null}
        <div className="cs-summary">
          <span>
            {layout.total} <b>{loaded ? profiles.length : '—'}</b>
          </span>
          <span>
            {layout.verified}{' '}
            <b>{loaded ? profiles.filter(profile => profile.loginState === 'verified').length : '—'}</b>
          </span>
        </div>
        <div className="cs-table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{layout.shopName}</th>
                <th>{native.amount}</th>
                <th>{browserRuntime.reception}</th>
                <th>{layout.checkedAt}</th>
                <th>{browserRuntime.enabled}</th>
                <th>{browserRuntime.noRepeat}</th>
                <th>{layout.operations}</th>
              </tr>
            </thead>
            <tbody>
              {profiles
                .filter(
                  profile =>
                    (filter === 'all' || profile.loginState === 'expired') &&
                    `${profile.displayName} ${profile.shopName ?? ''} ${profile.shopId ?? ''}`
                      .toLowerCase()
                      .includes(search.toLowerCase())
                )
                .map((profile, index) => (
                  <tr
                    data-profile-id={profile.id}
                    data-selected={selected === profile.id}
                    key={profile.id}
                    onClick={() => {
                      if (!opened) {
                        setSelected(profile.id)
                        onSelectedProfile?.(profile.id)
                      }
                    }}
                  >
                    <td>{index + 1}</td>
                    <td>
                      <button
                        className="cs-link"
                        disabled={!!opened}
                        onClick={() => {
                          setSelected(profile.id)
                          onSelectedProfile?.(profile.id)
                        }}
                        type="button"
                      >
                        {profile.shopName || profile.displayName}
                      </button>
                      <span className="cs-profile-login-state">{copy[profile.loginState]}</span>
                    </td>
                    <td className="cs-amber">{profile.payoutSettings?.remitAmount || '—'}</td>
                    <td>
                      <span className="cs-badge">{browserRuntime.unavailable}</span>
                    </td>
                    <td>{profile.checkedAt ? new Date(profile.checkedAt).toLocaleString(locale) : '—'}</td>
                    <td>
                      <button
                        aria-checked="mixed"
                        aria-describedby="shop-reception-service-unavailable"
                        aria-label={`${browserRuntime.enabled} · ${profile.shopName || profile.displayName}`}
                        className="cs-unknown-switch"
                        disabled
                        role="checkbox"
                        type="button"
                      >
                        —
                      </button>
                    </td>
                    <td>
                      <button
                        aria-checked="mixed"
                        aria-describedby="shop-reception-service-unavailable"
                        aria-label={`${browserRuntime.noRepeat} · ${profile.shopName || profile.displayName}`}
                        className="cs-unknown-switch"
                        disabled
                        role="checkbox"
                        type="button"
                      >
                        —
                      </button>
                    </td>
                    <td>
                      <div className="cs-actions cs-shop-row-actions">
                        <Button
                          aria-describedby="shop-reception-service-unavailable"
                          data-native-tone="success"
                          disabled
                          variant="secondary"
                        >
                          {browserRuntime.online}
                        </Button>
                        <Button
                          aria-describedby="shop-reception-service-unavailable"
                          data-native-tone="danger"
                          disabled
                          variant="secondary"
                        >
                          {browserRuntime.offline}
                        </Button>
                        <Button disabled={busy || !!opened} onClick={() => confirmRowAction('relogin', profile)} variant="secondary">
                          {copy.relogin}
                        </Button>
                        <Button disabled={busy || !!opened} onClick={() => confirmRowAction('delete', profile)} variant="secondary">
                          {copy.remove}
                        </Button>
                        <ShopSubAccountsButton disabled={busy || !!opened} profile={profile} runtime={runtime} />
                        <ShopPayoutSettingsButton
                          disabled={busy || !!opened}
                          onSaved={refresh}
                          profile={profile}
                          runtime={runtime}
                        />
                        <Button
                          disabled={busy || !!opened}
                          onClick={() => {
                            setSelected(profile.id)
                            onSelectedProfile?.(profile.id)
                          }}
                          variant="secondary"
                        >
                          {layout.select}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loaded && !profiles.length ? <p className="cs-empty">{copy.empty}</p> : null}
        </div>
        {selectedProfile ? (
          <div className="cs-profile-actions">
            <span role="status">
              {copy[selectedProfile.loginState]} · {selectedProfile.shopName || selectedProfile.displayName}
            </span>
            {selectedProfile.loginState === 'verified' ? <p role="status">{copy.sharedReady}</p> : null}
            <ShopSharedAssignment onSaved={refresh} profileId={selectedProfile.id} runtime={runtime} />
            <div className="cs-actions">
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
              {runtime.customerService && onOpenWorkflow ? (
                <Button disabled={busy} onClick={openWorkspace} variant="secondary">
                  {customerServiceCopy[locale].title}
                </Button>
              ) : null}
            </div>
            {confirmation ? (
              <div className="cs-confirm" role="alert">
                <p>{confirmation.profile.shopName || confirmation.profile.displayName}</p>
                <p>{confirmation.action === 'delete' ? copy.deleteWarning : copy.resetWarning}</p>
                {cloud ? <p>{shopCloudCopy[locale].sharedDelete}</p> : null}
                <Button disabled={busy} onClick={submitConfirmation}>
                  {confirmation.action === 'delete' ? copy.confirmDelete : copy.confirmReset}
                </Button>
                <Button disabled={busy} onClick={() => setConfirmation(null)} variant="secondary">
                  {copy.cancel}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {opened ? (
          <div className="cs-browser-section">
            <header>
              <h2>{selectedProfile?.shopName || selectedProfile?.displayName}</h2>
              <select
                aria-label={browserRuntime.switchShop}
                disabled={busy}
                onChange={event => open('merchant', event.target.value)}
                value={opened}
              >
                {profiles.map(profile => (
                  <option key={profile.id} value={profile.id}>
                    {profile.shopName || profile.displayName}
                  </option>
                ))}
              </select>
              <div>
                <Button
                  disabled={busy}
                  onClick={() => invoke({ action: 'identify', profileId: opened })}
                  variant="secondary"
                >
                  {copy.identify}
                </Button>
                <Button disabled={busy} onClick={() => invoke({ action: 'close' })} variant="secondary">
                  {copy.close}
                </Button>
              </div>
            </header>
            <ShopBrowserRuntimeSettings onClosed={browserClosed} runtime={runtime} />
            {selectedProfile?.loginState !== 'verified' ? <p>{copy.loginHint}</p> : null}
            {error ? (
              <p className="cs-error" role="alert">
                {copy.failed} ({error})
              </p>
            ) : null}
            <ShopBrowserWorkspacePanel
              key={opened}
              onClosed={browserClosed}
              profileId={opened}
              runtime={runtime}
              shopVerified={selectedProfile?.loginState === 'verified'}
              viewportRef={slot}
            />
          </div>
        ) : (
          <div className="cs-native-browser" ref={slot} style={{ height: 0 }} />
        )}
      </section>
    )
  }

  return (
    <section aria-label={copy.title} className="space-y-3">
      <h3>{copy.title}</h3>
      {cloud ? (
        <p data-testid="shop-cloud-status" role="status">
          {shopCloudCopy[locale][cloud.state]}
        </p>
      ) : null}
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
            disabled={busy || !!opened}
            onChange={event => {
              setSelected(event.target.value)
              onSelectedProfile?.(event.target.value)
              setConfirmation(null)
            }}
            value={selected}
          >
            <option value="">—</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.displayName} {profile.shopId ?? ''}
              </option>
            ))}
          </select>
        </label>
      ) : loaded ? (
        <p>{copy.empty}</p>
      ) : null}
      {selectedProfile ? (
        <>
          <p role="status">
            {copy[selectedProfile.loginState]} {selectedProfile.shopName ?? ''} {selectedProfile.checkedAt ?? ''}
          </p>
          {selectedProfile.loginState === 'verified' ? <p role="status">{copy.sharedReady}</p> : null}
          <ShopServiceAssignment onTransferred={refresh} profileId={selectedProfile.id} runtime={runtime} />
          <div className="flex flex-wrap items-center gap-2">
            <ShopPayoutSettingsButton
              disabled={busy}
              key={selectedProfile.id}
              onSaved={refresh}
              profile={selectedProfile}
              runtime={runtime}
            />
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
              <p>{confirmation.profile.shopName || confirmation.profile.displayName}</p>
              <p>{confirmation.action === 'delete' ? copy.deleteWarning : copy.resetWarning}</p>
              {cloud ? <p>{shopCloudCopy[locale].sharedDelete}</p> : null}
              <Button disabled={busy} onClick={submitConfirmation}>
                {confirmation.action === 'delete' ? copy.confirmDelete : copy.confirmReset}
              </Button>
              <Button disabled={busy} onClick={() => setConfirmation(null)} variant="secondary">
                {copy.cancel}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {opened ? (
        <>
          {selectedProfile?.loginState !== 'verified' ? <p>{copy.loginHint}</p> : null}
          <ShopBrowserWorkspacePanel
            key={opened}
            onClosed={browserClosed}
            profileId={opened}
            runtime={runtime}
            shopVerified={selectedProfile?.loginState === 'verified'}
            viewportRef={slot}
          />
        </>
      ) : (
        <div className="w-full" ref={slot} style={{ height: 0 }} />
      )}
    </section>
  )
}
