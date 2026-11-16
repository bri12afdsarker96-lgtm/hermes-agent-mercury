import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { customerServiceLayoutCopy } from '@/i18n/customer-service-layout'
import { shopPayoutCopy } from '@/i18n/shop-payout'

import type { ShopBrowserProfile } from '../../electron/shop-browser-types'
import {
  defaultShopPayoutSettings,
  type ShopPayoutSettings,
  validShopPayoutSettings
} from '../../electron/shop-payout-settings'

import type { EnterpriseClientRuntime } from './runtime'

interface Props {
  runtime: EnterpriseClientRuntime
  profile: ShopBrowserProfile
  disabled?: boolean
  onSaved(): Promise<void>
}

export function ShopPayoutSettingsButton({ runtime, profile, disabled, onSaved }: Props) {
  const { locale } = useI18n()
  const copy = shopPayoutCopy[locale]
  const layout = customerServiceLayoutCopy[locale]
  const lifecycle = useMemo(() => ({ runtime, profileId: profile.id, alive: true, busy: false }), [runtime, profile.id])
  const [draft, setDraft] = useState<ShopPayoutSettings>()
  const [days, setDays] = useState('15')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    lifecycle.alive = true
    setDraft(undefined)
    setError('')
    setBusy(false)

    return () => {
      lifecycle.alive = false
    }
  }, [lifecycle])

  const begin = () => {
    const settings = profile.payoutSettings ?? defaultShopPayoutSettings
    setDraft({ ...settings })
    setDays(String(settings.payoutReviewDays))
    setRevision(profile.payoutSettingsRevision ?? 0)
    setError('')
  }

  const save = async () => {
    if (!draft || lifecycle.busy || !lifecycle.runtime.shopBrowser) {
      return
    }

    const settings = { ...draft, payoutReviewDays: Number(days.trim()) }

    if (!/^[+]?[0-9]+$/.test(days.trim()) || !validShopPayoutSettings(settings)) {
      setError(copy.invalid)

      return
    }

    lifecycle.busy = true
    setBusy(true)
    setError('')

    try {
      const result = await lifecycle.runtime.shopBrowser({
        action: 'savePayoutSettings',
        profileId: lifecycle.profileId,
        payoutSettings: settings,
        expectedRevision: revision
      })

      if (!lifecycle.alive) {
        return
      }

      if (!result.ok) {
        if (result.error === 'SHOP_PAYOUT_SETTINGS_CONFLICT') {
          await onSaved()
        }

        throw new Error(result.error)
      }

      await onSaved()

      if (lifecycle.alive) {
        setDraft(undefined)
      }
    } catch (reason) {
      if (lifecycle.alive) {
        const code = reason instanceof Error ? reason.message : 'SHOP_PROFILE_FAILED'
        setError(code === 'SHOP_PAYOUT_SETTINGS_CONFLICT' ? copy.conflict : `${copy.failed} (${code})`)
      }
    } finally {
      lifecycle.busy = false

      if (lifecycle.alive) {
        setBusy(false)
      }
    }
  }

  return (
    <>
      <Button disabled={disabled} onClick={begin} variant="secondary">
        {copy.title}
      </Button>
      <Dialog
        onOpenChange={open => {
          if (!open && !busy) {
            setDraft(undefined)
          }
        }}
        open={!!draft}
      >
        <DialogContent bodyClassName="cs-dialog-body" className="cs-native-dialog cs-payout-dialog">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.evidence}</DialogDescription>
          {draft ? (
            <div className="cs-message-form">
              <p>
                {layout.shopName} <strong>{profile.shopName || profile.displayName}</strong>
              </p>
              <p>
                {layout.shopId} {profile.shopId ?? '—'}
              </p>
              <label>
                {copy.amount}
                <Input
                  disabled={busy}
                  inputMode="decimal"
                  onChange={event => setDraft({ ...draft, remitAmount: event.target.value })}
                  value={draft.remitAmount}
                />
              </label>
              <label>
                {copy.channel}
                <select
                  aria-label={copy.channel}
                  disabled={busy}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      payoutRefundChannel: event.target.value as ShopPayoutSettings['payoutRefundChannel']
                    })
                  }
                  value={draft.payoutRefundChannel}
                >
                  <option value="small_remit">{copy.smallRemit}</option>
                  <option value="refund_only">{copy.refundOnly}</option>
                </select>
              </label>
              <h3>{copy.conditions}</h3>
              <label>
                {copy.days}
                <Input
                  disabled={busy}
                  inputMode="numeric"
                  onChange={event => setDays(event.target.value)}
                  value={days}
                />
              </label>
              <label className="cs-payout-check">
                <input
                  checked={draft.payoutRequireReviewWithinDays}
                  disabled={busy}
                  onChange={event => setDraft({ ...draft, payoutRequireReviewWithinDays: event.target.checked })}
                  type="checkbox"
                />
                {copy.requireDays}
              </label>
              <label>
                {copy.goodReview}
                <select
                  aria-label={copy.goodReview}
                  disabled={busy}
                  onChange={event => setDraft({ ...draft, payoutGoodReviewMode: Number(event.target.value) as 0 | 1 })}
                  value={draft.payoutGoodReviewMode}
                >
                  <option value={0}>{copy.strict}</option>
                  <option value={1}>{copy.relaxed}</option>
                </select>
              </label>
              {error ? (
                <p className="cs-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="cs-dialog-actions">
                <Button disabled={busy} onClick={() => setDraft(undefined)} variant="secondary">
                  {copy.cancel}
                </Button>
                <Button disabled={busy} onClick={() => void save()}>
                  {busy ? copy.saving : copy.save}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
