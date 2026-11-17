import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { customerServiceCopy } from '@/i18n/customer-service'
import { customerServiceLayoutCopy } from '@/i18n/customer-service-layout'
import { nativeBusinessAdminCopy } from '@/i18n/native-business-admin'
import { nativeUiCopy } from '@/i18n/native-ui'
import { shopBrowserCopy } from '@/i18n/shop-browser'
import { shopBrowserRuntimeCopy } from '@/i18n/shop-browser-runtime'
import { shopCloudCopy } from '@/i18n/shop-cloud'

import type { ShopBrowserProfile, ShopBrowserReply, ShopBrowserRequest, ShopCsvExportResult } from '../../electron/shop-browser-types'
import { recoverableShopBrowserErrors } from '../../electron/shop-browser-types'

import { EnterpriseModalDialog } from './enterprise-design-system'
import { NativeAdminDialog } from './native-admin-dialog'
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
  const adminCopy = nativeBusinessAdminCopy[locale]
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
  const [exportResult, setExportResult] = useState<ShopCsvExportResult>()
  const currentRuntime = useRef(runtime)
  currentRuntime.current = runtime
  const [cloud, setCloud] = useState<ShopBrowserReply['cloud']>()
  const [assignmentAccess, setAssignmentAccess] = useState<{runtime: EnterpriseClientRuntime; allowed: boolean}>()
  const [assignmentProfile, setAssignmentProfile] = useState<{profile: ShopBrowserProfile; runtime: EnterpriseClientRuntime; epoch: number} | null>(null)
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const assignmentEpoch = useRef(0)
  const [confirmation, setConfirmation] = useState<{ action: 'relogin' | 'delete'; profile: ShopBrowserProfile; runtime: EnterpriseClientRuntime } | null>(null)
  const confirmationRef = useRef(confirmation)
  confirmationRef.current = confirmation
  const slot = useRef<HTMLDivElement>(null)
  const section = useRef<HTMLElement>(null)
  const removalTrigger = useRef<HTMLElement | null>(null)
  const removalFocusEpoch = useRef(0)
  const initialNavigation = useMemo(() => ({ target: initialTarget, opened: false }), [initialTarget])

  const lifecycle = useMemo(() => ({ runtime, alive: true, busy: false, boundsEpoch: 0, boundsTarget: null as string | null,
    openIntent: 0, refreshSequence: 0, resizeBounds: null as (() => void) | null }), [runtime])

  const selectedProfile = profiles.find(profile => profile.id === selected)

  useEffect(() => {
    let active = true
    assignmentEpoch.current++
    setAssignmentProfile(null)
    setAssignmentSaving(false)
    setAssignmentAccess(undefined)

    if (typeof runtime.get === 'function') {
      void runtime.get<{role?: string; tenant_id?: string; principal_id?: string}>('/api/whoami').then(identity => {
        if (active) {setAssignmentAccess({runtime, allowed: identity.role === 'tenant_admin' && !!identity.tenant_id && !!identity.principal_id})}
      }).catch(() => { if (active) {setAssignmentAccess({runtime, allowed: false})} })
    }

    return () => { active = false }
  }, [runtime])

  useEffect(() => {
    if (assignmentProfile && loaded && !profiles.some(profile => profile.id === assignmentProfile.profile.id)) {
      assignmentEpoch.current++
      setAssignmentProfile(null)
      setAssignmentSaving(false)
    }
  }, [assignmentProfile, loaded, profiles])

  const restoreRemovalFocus = useCallback(() => {
    const trigger = removalTrigger.current
    const epoch = ++removalFocusEpoch.current

    requestAnimationFrame(() => {
      if (!lifecycle.alive || removalFocusEpoch.current !== epoch) {return}
      const active = document.activeElement

      if (active && active !== document.body && active !== trigger && active !== section.current && active.isConnected) {return}

      if (trigger?.isConnected && !trigger.matches(':disabled')) {trigger.focus()}
      else {section.current?.focus()}
    })
  }, [lifecycle])

  const restoreRemovalOnAuthorityLoss = useCallback(() => {
    if (confirmationRef.current?.action === 'delete' && confirmationRef.current.runtime === lifecycle.runtime) {
      restoreRemovalFocus()
    }
  }, [lifecycle, restoreRemovalFocus])

  const refresh = useCallback(async () => {
    const sequence = ++lifecycle.refreshSequence
    const intent = lifecycle.openIntent
    let reply: ShopBrowserReply

    try {
      reply = await lifecycle.runtime.shopBrowser!({ action: 'list' })
    } catch (reason) {
      if (!lifecycle.alive) {return}
      const code = reason instanceof Error ? reason.message : ''

      if (/OWNER_CHANGED|ACCESS_UNAVAILABLE|FORBIDDEN/.test(code)) {
        restoreRemovalOnAuthorityLoss()
        lifecycle.openIntent++
        lifecycle.refreshSequence++
        lifecycle.boundsEpoch++
        lifecycle.boundsTarget = null
        setOpened(null)
        setLoaded(false)
        setCloud(undefined)
        setProfiles([])
        setSelected('')
        setConfirmation(null)
        onProfilesChange?.([])
        onSelectedProfile?.('')
        throw reason
      }

      if (sequence !== lifecycle.refreshSequence || intent !== lifecycle.openIntent) {return}
      throw reason
    }

    if (!lifecycle.alive) {
      return
    }

    const authorityFailure = !reply.ok && /OWNER_CHANGED|ACCESS_UNAVAILABLE|FORBIDDEN/.test(reply.error ?? '')

    if (!authorityFailure && (sequence !== lifecycle.refreshSequence || intent !== lifecycle.openIntent)) {
      return
    }

    if (!reply.ok) {
      if (authorityFailure) {
        restoreRemovalOnAuthorityLoss()
        lifecycle.openIntent++
        lifecycle.refreshSequence++
        lifecycle.boundsEpoch++
        lifecycle.boundsTarget = null
        setConfirmation(null)
      }

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

    const nextOpened = reply.openProfileId ?? null

    if (lifecycle.boundsTarget !== nextOpened) {
      lifecycle.boundsEpoch++
      lifecycle.boundsTarget = nextOpened
    }

    setCloud(reply.cloud)
    onProfilesChange?.(reply.profiles ?? [])
    setOpened(nextOpened)
  }, [lifecycle, onProfilesChange, onSelectedProfile, restoreRemovalOnAuthorityLoss])

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
            restoreRemovalOnAuthorityLoss()
            lifecycle.openIntent++
            lifecycle.refreshSequence++
            lifecycle.boundsEpoch++
            lifecycle.boundsTarget = null
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
    [lifecycle, onProfilesChange, onSelectedProfile, restoreRemovalOnAuthorityLoss]
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
    setExportResult(undefined)
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

    let active = true

    const handleFailure = (code: string | undefined, epoch: number) => {
      if (!lifecycle.alive) {return}
      const authorityFailure = /OWNER_CHANGED|ACCESS_UNAVAILABLE|FORBIDDEN/.test(code ?? '')

      if (!authorityFailure && (!active || epoch !== lifecycle.boundsEpoch || lifecycle.boundsTarget !== opened)) {return}
      setOpened(null)
      setError(code ?? 'SHOP_PROFILE_FAILED')

      if (authorityFailure) {
        restoreRemovalOnAuthorityLoss()
        lifecycle.openIntent++
        lifecycle.refreshSequence++
        lifecycle.boundsEpoch++
        lifecycle.boundsTarget = null
        setCloud(undefined)
        setProfiles([])
        setSelected('')
        setConfirmation(null)
        onProfilesChange?.([])
        onSelectedProfile?.('')
      }
    }

    const resize = () => {
      if (!active || lifecycle.boundsTarget !== opened) {return}
      const epoch = lifecycle.boundsEpoch
      void runtime.shopBrowser!({ action: 'bounds', profileId: opened, bounds: bounds() })
        .then(reply => {
          if (!reply.ok) {handleFailure(reply.error, epoch)}
        })
        .catch(reason => handleFailure(reason instanceof Error ? reason.message : undefined, epoch))
    }

    lifecycle.resizeBounds = resize

    const observer = new ResizeObserver(resize)
    observer.observe(slot.current)
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', resize, true)
    resize()

    return () => {
      active = false
      lifecycle.boundsEpoch++

      if (lifecycle.resizeBounds === resize) {lifecycle.resizeBounds = null}
      observer.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', resize, true)
    }
  }, [opened, runtime, lifecycle, bounds, onProfilesChange, onSelectedProfile, restoreRemovalOnAuthorityLoss])

  const invoke = useCallback(
    (request: Omit<ShopBrowserRequest, 'sessionId'>) =>
      void run(async () => {
        let intent: number | undefined

        if (request.action === 'open') {
          intent = ++lifecycle.openIntent
          lifecycle.boundsEpoch++
          lifecycle.boundsTarget = request.profileId ?? null
        }

        const reply = await runtime.shopBrowser!(request)

        if (!lifecycle.alive || (intent !== undefined && intent !== lifecycle.openIntent &&
          (reply.ok || !/OWNER_CHANGED|ACCESS_UNAVAILABLE|FORBIDDEN/.test(reply.error ?? '')))) {
          return
        }

        if (!reply.ok) {
          if (/OWNER_CHANGED|ACCESS_UNAVAILABLE|FORBIDDEN/.test(reply.error ?? '')) {
            throw new Error(reply.error)
          }

          if (request.action === 'open') {
            await refresh()

            if (intent !== lifecycle.openIntent || !lifecycle.alive) {return}
            lifecycle.resizeBounds?.()
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
      setExportResult(undefined)
      const reply = await runtime.shopBrowser!({ action: 'exportCsv', locale })

      if (!lifecycle.alive || currentRuntime.current !== runtime) {
        return
      }

      if (!reply.ok) {
        throw new Error(reply.error)
      }

      const result = reply.exportResult

      if (!result || !['saved', 'canceled', 'empty', 'busy', 'owner_changed', 'authorization_unavailable', 'cloud_unavailable', 'write_failed'].includes(result.status) ||
        (result.status === 'saved' && (!Number.isSafeInteger(result.count) || result.count < 1))) {
        setExportResult({status:'write_failed'})

        return
      }

      setExportResult(result)

      if (result.status === 'owner_changed') {throw new Error('SHOP_PROFILE_OWNER_CHANGED')}

      if (result.status === 'authorization_unavailable') {throw new Error('SHOP_PROFILE_ACCESS_UNAVAILABLE')}
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
        setConfirmation({ action, profile, runtime })
      }
    })

  const confirmRowAction = (action: 'relogin' | 'delete', profile: ShopBrowserProfile, trigger: HTMLElement) => {
    removalFocusEpoch.current++

    if (action === 'delete') {removalTrigger.current = trigger}
    setConfirmation({ action, profile, runtime })
    setSelected(profile.id)
    onSelectedProfile?.(profile.id)
  }

  const closeRemoval = useCallback(() => {
    if (lifecycle.busy) {return}
    setConfirmation(null)
    restoreRemovalFocus()
  }, [lifecycle, restoreRemovalFocus])

  const submitConfirmation = () => {
    const pending = confirmation

    if (!pending || pending.runtime !== runtime) {return}
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

      try {
        await refresh()
      } finally {
        if (pending.action === 'delete' && lifecycle.alive) {restoreRemovalFocus()}
      }

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
      <section aria-label={layout.shops} className="cs-native-page cs-shops" data-browser-open={!!opened} ref={section} tabIndex={-1}>
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
        {exportResult ? <p role={['write_failed', 'cloud_unavailable', 'owner_changed', 'authorization_unavailable'].includes(exportResult.status) ? 'alert' : 'status'}>{
          exportResult.status === 'saved' ? `${copy.exportSaved}${exportResult.count}` :
          exportResult.status === 'canceled' ? copy.exportCanceled :
          exportResult.status === 'empty' ? copy.exportEmpty :
          exportResult.status === 'busy' ? copy.exportBusy :
          exportResult.status === 'owner_changed' ? copy.exportOwnerChanged :
          exportResult.status === 'authorization_unavailable' ? copy.exportAuthorizationUnavailable :
          exportResult.status === 'cloud_unavailable' ? copy.exportCloudUnavailable : copy.exportWriteFailed
        }</p> : null}
        {error && confirmation?.action !== 'delete' ? (
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
                        <Button disabled={busy || !!opened} onClick={event => confirmRowAction('relogin', profile, event.currentTarget)} variant="secondary">
                          {copy.relogin}
                        </Button>
                        <Button disabled={busy || !!opened} onClick={event => confirmRowAction('delete', profile, event.currentTarget)} variant="secondary">
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
                        {assignmentAccess?.runtime === runtime && assignmentAccess.allowed ? (
                          <Button disabled={busy} onClick={() => setAssignmentProfile({profile, runtime, epoch: ++assignmentEpoch.current})} variant="secondary">
                            {adminCopy.assignments}
                          </Button>
                        ) : null}
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
              <Button disabled={busy} onClick={event => {removalFocusEpoch.current++; removalTrigger.current = event.currentTarget; confirm('delete')}} variant="secondary">
                {copy.remove}
              </Button>
              {runtime.customerService && onOpenWorkflow ? (
                <Button disabled={busy} onClick={openWorkspace} variant="secondary">
                  {customerServiceCopy[locale].title}
                </Button>
              ) : null}
            </div>
            {confirmation?.runtime === runtime && confirmation.action === 'relogin' ? (
              <div className="cs-confirm" role="alert">
                <p>{confirmation.profile.shopName || confirmation.profile.displayName}</p>
                <p>{copy.resetWarning}</p>
                {cloud ? <p>{shopCloudCopy[locale].sharedDelete}</p> : null}
                <Button disabled={busy} onClick={submitConfirmation}>
                  {copy.confirmReset}
                </Button>
                <Button disabled={busy} onClick={() => setConfirmation(null)} variant="secondary">
                  {copy.cancel}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {assignmentProfile?.runtime === runtime ? (
          <NativeAdminDialog busy={assignmentSaving} description={adminCopy.assignmentEvidence}
            onClose={() => {assignmentEpoch.current++; setAssignmentProfile(null)}} open title={`${adminCopy.assignments} · ${assignmentProfile.profile.shopName || assignmentProfile.profile.displayName}`}>
            <ShopSharedAssignment onBusyChange={value => {if (assignmentEpoch.current === assignmentProfile.epoch) {setAssignmentSaving(value)}}} onSaved={refresh} profileId={assignmentProfile.profile.id} runtime={runtime} />
          </NativeAdminDialog>
        ) : null}
        {confirmation?.runtime === runtime && confirmation.action === 'delete' ? (
          <EnterpriseModalDialog label={copy.confirmDelete} onClose={closeRemoval}>
            <div className="cs-confirm">
              <p>{confirmation.profile.shopName || confirmation.profile.displayName} ({confirmation.profile.shopId || confirmation.profile.id})</p>
              <p>{copy.deleteWarning}</p>
              {cloud ? <p>{shopCloudCopy[locale].sharedDelete}</p> : null}
              {error ? <p className="cs-error" role="alert">{copy.failed} ({error})</p> : null}
              <Button disabled={busy} onClick={submitConfirmation}>{copy.confirmDelete}</Button>
              <Button disabled={busy} onClick={closeRemoval} variant="secondary">{copy.cancel}</Button>
            </div>
          </EnterpriseModalDialog>
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
