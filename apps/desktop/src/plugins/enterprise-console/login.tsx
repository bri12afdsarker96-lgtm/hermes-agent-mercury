/**
 * EnterpriseLogin — the Design-System Login / native-session bootstrap
 * presentation (R5-B). Visual authority:
 *   D:\下载\Hermes Enterprise Desktop Design System.zip
 *   ui_kits/enterprise-desktop/Login.jsx + refs/ref1-login.png
 *
 * NO fake login. The renderer holds no credential and no URL — main owns the
 * bearer (B16-OL one-login). The primary action re-probes the main-owned native
 * session via the EXISTING `reprobeEnterpriseSession()` seam; the page then
 * reports the session FSM ($sessionState) honestly. A successful native sign-in
 * is observed through the existing `onConnectionApplied` push seam, and the
 * shell mounts the authenticated console the moment `$whoami` resolves.
 *
 * There is deliberately NO renderer-typed enterprise-domain input and NO token
 * field: both would be a second credential surface the product forbids.
 */

import { Button, icons, usePluginI18n, useValue } from '@hermes/plugin-sdk'

import { BrandMark } from './brand-mark'
import { reprobeEnterpriseSession } from './one-login'
import { $connectError, $connecting, $sessionState } from './session'

const FEATURES: Array<{ body: string; icon: icons.IconComponent; title: string }> = [
  { body: 'login.featureSsoBody', icon: icons.Globe, title: 'login.featureSso' },
  { body: 'login.featureVaultBody', icon: icons.Lock, title: 'login.featureVault' },
  { body: 'login.featureSyncBody', icon: icons.Users, title: 'login.featureSync' }
]

const CHECKS: string[] = ['login.check1', 'login.check2', 'login.check3']

/** Honest per-state copy for the session status row. */
function stateCopy(
  state: ReturnType<typeof $sessionState.get>,
  t: (key: string) => string
): { body: string; dot: 'danger' | 'info' | 'progress'; label: string } {
  if (state === 'UNAVAILABLE') {
    return { body: t('login.state.unavailableBody'), dot: 'danger', label: t('login.state.unavailable') }
  }

  if (state === 'REVOKED') {
    return { body: t('login.state.revokedBody'), dot: 'danger', label: t('login.state.revoked') }
  }

  if (state === 'AUTHENTICATED') {
    return { body: '', dot: 'info', label: t('login.state.connected') }
  }

  return { body: t('login.state.unknownBody'), dot: 'info', label: t('login.state.unknown') }
}

export function EnterpriseLogin() {
  const t = usePluginI18n('enterprise-console')
  const connecting = useValue($connecting)
  const state = useValue($sessionState)
  const connectError = useValue($connectError)
  const copy = stateCopy(state, t)

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-session-state={state.toLowerCase()}
      data-testid="enterprise-login"
    >
      <div className="flex min-h-0 flex-1">
        {/* ── Brand panel (Login.jsx left column) ─────────────────────────── */}
        <div
          aria-hidden="true"
          className="hidden min-h-0 flex-1 flex-col border-r border-(--ui-stroke-tertiary) p-14 md:flex"
          data-testid="enterprise-login-brand"
          style={{
            background:
              'linear-gradient(160deg, color-mix(in srgb, var(--ui-blue) 12%, var(--ui-bg-canvas)) 0%, color-mix(in srgb, var(--ui-blue) 24%, var(--ui-bg-canvas)) 60%, var(--ui-bg-canvas) 100%)'
          }}
        >
          <div className="mb-auto max-w-110">
            <BrandMark size="lg" />
            <h2 className="mt-5.5 text-xl leading-7.5 font-semibold text-(--ui-text-primary)">
              {t('login.productHeadline')}
            </h2>
            <p className="mt-2.5 text-sm leading-6 text-(--ui-text-secondary)">{t('login.productBody')}</p>
            <ul className="mt-4 flex flex-col gap-2 p-0">
              {CHECKS.map(key => (
                <li className="flex items-center gap-2 text-[13px] text-(--ui-text-secondary)" key={key}>
                  <icons.CheckCircle2
                    aria-hidden="true"
                    className="size-4.25 shrink-0 text-(--ec-module-assistant)"
                    stroke={2}
                  />
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
          <div
            className="mt-4 grid grid-cols-3 rounded-xl border border-(--ui-stroke-secondary) px-2 py-4.5"
            style={{ background: 'color-mix(in oklch, var(--ui-bg-card) 70%, transparent)' }}
          >
            {FEATURES.map((feature, i) => (
              <div
                className={
                  i
                    ? 'flex items-center gap-2.5 border-l border-(--ui-stroke-tertiary) px-3.5'
                    : 'flex items-center gap-2.5 px-3.5'
                }
                key={feature.title}
              >
                <span
                  className="flex size-8.5 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: 'color-mix(in srgb, var(--ui-blue) 18%, transparent)',
                    color: 'var(--ui-blue)'
                  }}
                >
                  <feature.icon className="size-4.25" stroke={2} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-(--ui-text-primary)">
                    {t(feature.title)}
                  </span>
                  <span className="block truncate text-[11px] text-(--ui-text-tertiary)">{t(feature.body)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Sign-in panel (Login.jsx right column) ──────────────────────── */}
        <div className="flex w-full min-w-0 flex-col justify-center gap-5.5 px-10 py-8 md:w-[46%] md:px-14">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-(--ui-text-primary)">{t('login.title')}</h1>
            <p className="mt-2.5 text-sm leading-6 text-(--ui-text-secondary)">{t('login.subtitle')}</p>
          </div>

          {/* Honest session row — the design's domain field, without the fake
              renderer input. The server endpoint is main-owned; only state
              is shown. */}
          <div
            aria-live="polite"
            className="flex items-start gap-3 rounded-(--ec-panel-radius) border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-4 py-3"
            data-testid="enterprise-login-session"
          >
            <span
              aria-hidden="true"
              className={
                copy.dot === 'danger'
                  ? 'mt-0.5 size-2 shrink-0 rounded-full bg-(--ec-status-danger)'
                  : 'mt-0.5 size-2 shrink-0 rounded-full bg-(--ec-status-info)'
              }
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-(--ui-text-primary)">
                {connecting ? t('login.state.connecting') : copy.label}
              </span>
              {!connecting && copy.body ? (
                <span className="block text-[11px] text-(--ui-text-tertiary)">{copy.body}</span>
              ) : null}
              {connectError ? (
                <span className="block text-[11px] text-(--ui-text-tertiary)">{connectError}</span>
              ) : null}
            </span>
          </div>

          <Button
            className="w-full"
            data-testid="enterprise-login-primary"
            disabled={connecting}
            onClick={() => reprobeEnterpriseSession()}
            size="lg"
          >
            <icons.Globe className="size-4.25" stroke={2} />
            {t('login.action')}
          </Button>

          <div aria-hidden="true" className="flex items-center gap-3.5 text-(--ui-text-tertiary)">
            <span className="h-px flex-1 bg-(--ui-stroke-secondary)" />
            {t('login.or')}
            <span className="h-px flex-1 bg-(--ui-stroke-secondary)" />
          </div>

          <Button
            className="w-full"
            data-testid="enterprise-login-retry"
            disabled={connecting}
            onClick={() => reprobeEnterpriseSession()}
            size="lg"
            variant="outline"
          >
            <icons.RefreshCw className="size-4.25" stroke={2} />
            {t('login.retry')}
          </Button>

          <div
            className="flex items-center justify-center gap-2 rounded-(--ec-panel-radius) bg-(--ui-bg-secondary) px-3.5 py-3.5 text-(--ui-text-secondary)"
            style={{ fontSize: '12px' }}
          >
            <icons.CheckCircle2 aria-hidden="true" className="size-4.25 shrink-0 text-(--ec-status-success)" stroke={2} />
            {t('login.footerNote')}
          </div>
        </div>
      </div>
    </div>
  )
}
