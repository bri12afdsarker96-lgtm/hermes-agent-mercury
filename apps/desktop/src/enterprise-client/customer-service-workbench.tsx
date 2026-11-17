import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { customerServiceCopy } from '@/i18n/customer-service'
import { customerServiceLayoutCopy } from '@/i18n/customer-service-layout'
import { nativeUiCopy } from '@/i18n/native-ui'
import { shopBrowserRuntimeCopy } from '@/i18n/shop-browser-runtime'

import type { ShopBrowserProfile } from '../../electron/shop-browser-types'

import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserRuntimeSettings } from './shop-browser-runtime'

export function CustomerServiceWorkbench({
  runtime,
  profileId,
  profiles,
  onSelectProfile,
  onRefresh
}: {
  runtime: EnterpriseClientRuntime
  profileId: string
  profiles: ShopBrowserProfile[]
  onSelectProfile?: (id: string) => void
  onRefresh?: () => void
}) {
  const { locale } = useI18n()
  const layout = customerServiceLayoutCopy[locale]
  const native = nativeUiCopy[locale]
  const reception = shopBrowserRuntimeCopy[locale]
  const [search, setSearch] = useState('')
  const [dismissed, setDismissed] = useState<string[]>([])

  const warnings = profiles.filter(
    profile => profile.loginState === 'expired' && !dismissed.includes(`${profile.id}:${profile.checkedAt}`)
  )

  return (
    <section className="cs-service" data-testid="customer-service-workbench">
      <div className="cs-toolbar cs-service-toolbar">
        <span role="status">{reception.unavailable}</span>
        <ShopBrowserRuntimeSettings runtime={runtime} />
        <Button disabled={!onRefresh} onClick={onRefresh} variant="secondary">
          {customerServiceCopy[locale].refresh}
        </Button>
      </div>
      <div className="cs-work-columns">
        <section className="cs-column">
          <div className="cs-column-head cs-shop-search">
            <select aria-label={native.shopFilter} defaultValue="all">
              <option value="all">{layout.all}</option>
              <option disabled value="pending">{layout.pendingOnly}</option>
            </select>
            <Input
              aria-label={layout.searchShops}
              onChange={event => setSearch(event.target.value)}
              placeholder={layout.searchShops}
              value={search}
            />
          </div>
          <div className="cs-scroll">
            {profiles
              .filter(profile =>
                `${profile.shopName ?? ''} ${profile.displayName} ${profile.shopId ?? ''}`
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
              .map(profile => (
                <button
                  className="cs-list-row cs-work-shop"
                  data-active={profile.id === profileId}
                  key={profile.id}
                  onClick={() => onSelectProfile?.(profile.id)}
                  type="button"
                >
                  <span>{profile.shopName || profile.displayName}</span>
                  <span aria-label={native.unknownCount}>—</span>
                </button>
              ))}
          </div>
        </section>
        <section className="cs-column">
          <div className="cs-column-head">
            <h4>{layout.nativePending}</h4>
            <span aria-label={native.unknownCount}>—</span>
          </div>
        </section>
        <section className="cs-column cs-chat">
          <div className="cs-column-head">
            <h4>{layout.chat}</h4>
            <div className="cs-actions">
              <Button disabled variant="secondary">
                {layout.handle}
              </Button>
            </div>
          </div>
        </section>
        <section className="cs-column cs-activity">
          <div className="cs-column-head">
            <h4 className="cs-red">{layout.loginLog}</h4>
            <Button
              disabled={!warnings.length}
              onClick={() =>
                setDismissed(previous => [
                  ...previous,
                  ...warnings.map(profile => `${profile.id}:${profile.checkedAt}`)
                ])
              }
              variant="secondary"
            >
              {native.clear}
            </Button>
          </div>
          <div className="cs-login-log">
            {warnings.map(profile => (
              <p key={profile.id}>
                [{profile.checkedAt ? new Date(profile.checkedAt).toLocaleString(locale) : '—'}]{' '}
                {profile.shopName || profile.displayName} · {layout.loginLog}
              </p>
            ))}
            {!warnings.length ? <p className="cs-muted">{layout.noLoginIssues}</p> : null}
          </div>
        </section>
      </div>
    </section>
  )
}
