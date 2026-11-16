import './customer-service.css'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n/context'
import { customerServiceCopy } from '@/i18n/customer-service'
import { customerServiceLayoutCopy } from '@/i18n/customer-service-layout'
import { shopBrowserCopy } from '@/i18n/shop-browser'
import { LayoutDashboard, MessageSquareText, NotebookTabs, Users } from '@/lib/icons'

import type { ShopBrowserProfile } from '../../electron/shop-browser-types'

import { CustomerServicePreviewPanel } from './customer-service-preview'
import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserProfilesPanel } from './shop-browser-profiles'

type Page = 'shops' | 'rules' | 'workbench' | 'authorization'

export function CustomerServicePage({
  runtime,
  employeeId
}: {
  runtime?: EnterpriseClientRuntime | null
  employeeId?: string
}) {
  const { locale } = useI18n()
  const copy = customerServiceCopy[locale]
  const layout = customerServiceLayoutCopy[locale]
  const [page, setPage] = useState<Page>('shops')
  const [profiles, setProfiles] = useState<ShopBrowserProfile[]>([])
  const [selected, setSelected] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [initialTarget, setInitialTarget] = useState<'feige'>()
  const [owner, setOwner] = useState(runtime)
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState('')
  const [profilesRevision, setProfilesRevision] = useState(0)

  useEffect(() => {
    setPage('shops')
    setProfiles([])
    setSelected('')
    setInitialTarget(undefined)
    setEvidenceOpen(false)
    setOwner(runtime)
    setProfilesLoading(true)
    setProfilesError('')
  }, [runtime])

  const updateProfiles = useCallback((next: ShopBrowserProfile[]) => {
    setProfiles(next)
    setProfilesLoading(false)
    setProfilesError('')
    setSelected(current => (next.some(profile => profile.id === current) ? current : (next[0]?.id ?? '')))
  }, [])

  useEffect(() => {
    if (!runtime?.shopBrowser || owner !== runtime || page === 'shops') {
      return
    }

    let alive = true
    let pending = false

    const refresh = async () => {
      if (pending) {
        return
      }

      pending = true
      setProfilesLoading(true)

      try {
        const reply = await runtime.shopBrowser!({ action: 'list' })

        if (alive) {
          if (!reply.ok) {
            throw new Error(reply.error ?? 'SHOP_PROFILE_FAILED')
          }

          updateProfiles(reply.profiles ?? [])
        }
      } catch (reason) {
        if (alive) {
          setProfiles([])
          setSelected('')
          setProfilesError(reason instanceof Error ? reason.message : 'SHOP_PROFILE_FAILED')
        }
      } finally {
        pending = false

        if (alive) {
          setProfilesLoading(false)
        }
      }
    }

    // This request belongs to the feature, so leaving the shop browser cannot
    // discard the only list response required by rules and the agent workspace.
    void refresh()
    const timer = setInterval(() => void refresh(), 10000)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [runtime, owner, page, profilesRevision, updateProfiles])

  const navigate = (next: Page) => {
    if (next === page) {
      return
    }

    setInitialTarget(undefined)
    setProfilesError('')
    setProfilesLoading(next !== 'shops')
    setPage(next)
  }

  const selectedProfile = profiles.find(profile => profile.id === selected)

  if (owner !== runtime) {
    return <Loader />
  }

  return (
    <section className="cs-native" data-testid="customer-service-page">
      <aside className="cs-sidebar">
        <div className="cs-brand">
          <span aria-hidden="true">☏</span>
          <strong>{layout.title}</strong>
        </div>
        <nav aria-label={layout.title}>
          {(
            [
              ['shops', LayoutDashboard, layout.shops],
              ['rules', NotebookTabs, copy.rules],
              ['workbench', MessageSquareText, layout.workbench],
              ['authorization', Users, layout.authorization]
            ] as const
          ).map(([id, Icon, title]) => (
            <button data-active={page === id} key={id} onClick={() => navigate(id)} type="button">
              <span aria-hidden="true">
                <Icon />
              </span>
              {title}
            </button>
          ))}
        </nav>
        <div className="cs-sidebar-footer">
          <i className="cs-status-dot" />
          <span>{copy.rehearsal}</span>
          <Button onClick={() => setEvidenceOpen(true)} variant="ghost">
            {copy.evidence}
          </Button>
        </div>
      </aside>
      <main className="cs-native-content">
        {!runtime?.shopBrowser ? (
          <p className="cs-empty">{copy.noTransport}</p>
        ) : (
          <>
            {page !== 'shops' && profilesLoading ? <p role="status">{shopBrowserCopy[locale].pending}</p> : null}
            {page !== 'shops' && profilesError ? (
              <div className="cs-error" role="alert">
                <p>{shopBrowserCopy[locale].failed} ({profilesError})</p>
                <Button onClick={() => setProfilesRevision(value => value + 1)} variant="secondary">
                  {shopBrowserCopy[locale].refresh}
                </Button>
              </div>
            ) : null}
            {page === 'shops' ? (
              <ShopBrowserProfilesPanel
                initialTarget={initialTarget}
                nativeLayout
                onOpenWorkflow={() => navigate('rules')}
                onProfilesChange={updateProfiles}
                onSelectedProfile={setSelected}
                runtime={runtime}
                selectedProfileId={selected}
              />
            ) : null}
            {page === 'rules' || page === 'workbench' ? (
              <>
                <div className="cs-profile-picker">
                  <label>
                    {layout.currentShop}
                    <select
                      aria-label={layout.selectShop}
                      onChange={event => setSelected(event.target.value)}
                      value={selected}
                    >
                      <option value="">{layout.selectShop}</option>
                      {profiles.map(profile => (
                        <option key={profile.id} value={profile.id}>
                          {profile.shopName || profile.displayName} {profile.shopId ?? ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {selectedProfile ? (
                  <CustomerServicePreviewPanel
                    key={selectedProfile.id}
                    onHandle={() => {
                      setInitialTarget('feige')
                      setPage('shops')
                    }}
                    onSelectProfile={setSelected}
                    profileId={selectedProfile.id}
                    profiles={profiles}
                    runtime={runtime}
                    view={page}
                  />
                ) : !profilesLoading && !profilesError ? (
                  <p className="cs-empty">{layout.noProfile}</p>
                ) : null}
              </>
            ) : null}
            {page === 'authorization' ? (
              <section className="cs-native-page">
                <h2>{layout.authorization}</h2>
                <p className="cs-scope-note">{layout.authorizationEvidence}</p>
                <div className="cs-table-wrap">
                  <table className="cs-table">
                    <thead>
                      <tr>
                        <th>{layout.employee}</th>
                        <th>{layout.shopName}</th>
                        <th>{layout.shopId}</th>
                        <th>{layout.profileScope}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profiles.map(profile => (
                        <tr key={profile.id}>
                          <td>{employeeId ?? profile.principalId}</td>
                          <td>{profile.shopName || profile.displayName}</td>
                          <td>{profile.shopId ?? '—'}</td>
                          <td>{layout.profileScope}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
      <Dialog onOpenChange={setEvidenceOpen} open={evidenceOpen}>
        <DialogContent bodyClassName="cs-dialog-body" className="cs-native-dialog cs-evidence-dialog">
          <DialogTitle>{copy.evidence}</DialogTitle>
          <DialogDescription>{layout.layoutEvidence}</DialogDescription>
          <p>{copy.nativeEvidence}</p>
          <code>IntentRuleEditWindow.cs 383–505, 688–791</code>
          <p>{copy.simulationEvidence}</p>
          <p>{copy.recoveryEvidence}</p>
          <code>WorkbenchPage.cs 2931–3295 / GatewayClient.cs 2595</code>
          <p>{copy.scopeEvidence}</p>
        </DialogContent>
      </Dialog>
    </section>
  )
}
