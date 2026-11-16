import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { nativeBusinessAdminCopy } from '@/i18n/native-business-admin'

import { NativeAdminDialog, NativeAdminPassword } from './native-admin-dialog'
import { businessAdminErrorKey, nativeBusinessAdminApi, type ShopMailbox } from './native-business-admin-api'
import type { EnterpriseClientRuntime } from './runtime'

export function ShopMailboxButton({ runtime, disabled }: { runtime: EnterpriseClientRuntime; disabled?: boolean }) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const [openedFor, setOpenedFor] = useState<EnterpriseClientRuntime>()

  return (
    <>
      <Button data-native-tone="amber" disabled={disabled} onClick={() => setOpenedFor(runtime)} variant="secondary">
        {copy.mailbox}
      </Button>
      {openedFor === runtime ? <MailboxEditor onClose={() => setOpenedFor(undefined)} runtime={runtime} /> : null}
    </>
  )
}

function MailboxEditor({ runtime, onClose }: { runtime: EnterpriseClientRuntime; onClose(): void }) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const api = useMemo(() => nativeBusinessAdminApi(runtime), [runtime])
  const scope = useMemo(() => ({ runtime, alive: true, pending: false }), [runtime])
  const [original, setOriginal] = useState<ShopMailbox>()
  const [providerKey, setProviderKey] = useState<'qq' | '126'>('qq')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    scope.alive = true
    setBusy(true)
    setOriginal(undefined)
    setPassword('')
    setError('')
    void api
      .getMailbox()
      .then(value => {
        if (active) {
          setOriginal(value)
          setProviderKey(value.providerKey)
          setUser(value.user)
        }
      })
      .catch(reason => {
        if (active) {
          setError(copy[businessAdminErrorKey(reason)])
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false)
        }
      })

    return () => {
      active = false
      scope.alive = false
    }
  }, [api, scope, attempt, copy])

  async function execute(test: boolean) {
    if (scope.pending || !original) {
      return
    }

    const account = user.trim()
    const changed = account !== original.user || providerKey !== original.providerKey

    if (!account || (!password && !original.hasPassword)) {
      setError(copy.mailboxRequired)

      return
    }

    if (changed && !password) {
      setError(copy.changedMailboxPassword)

      return
    }

    scope.pending = true
    setBusy(true)
    setError('')
    setNotice('')
    const draft = { providerKey, user: account, password: password || undefined, expectedRevision: original.revision }

    try {
      if (test) {
        await api.testMailbox(draft)

        if (scope.alive) {
          setNotice(copy.tested)
        }
      } else {
        const saved = await api.saveMailbox(draft)

        if (!scope.alive) {
          return
        }

        const confirmed = await api.getMailbox()

        if (!scope.alive) {
          return
        }

        if (
          confirmed.revision < saved.revision ||
          confirmed.user !== account ||
          confirmed.providerKey !== providerKey
        ) {
          throw new Error('SHOP_MAILBOX_READBACK_INVALID')
        }

        setOriginal(confirmed)
        setPassword('')
        onClose()
      }
    } catch (reason) {
      if (scope.alive) {
        setError(copy[businessAdminErrorKey(reason)])
      }
    } finally {
      scope.pending = false

      if (scope.alive) {
        setBusy(false)
      }
    }
  }

  return (
    <NativeAdminDialog
      busy={busy}
      className="cs-mailbox-dialog"
      description={copy.mailboxEvidence}
      onClose={onClose}
      open
      title={copy.mailbox}
    >
      <div className="cs-admin-form">
        <label>
          {copy.provider}
          <select
            disabled={busy || !original}
            onChange={event => setProviderKey(event.target.value as 'qq' | '126')}
            value={providerKey}
          >
            <option value="qq">{copy.qq}</option>
            <option value="126">{copy.mail126}</option>
          </select>
        </label>
        <label>
          {copy.address}
          <Input
            autoComplete="off"
            disabled={busy || !original}
            onChange={event => setUser(event.target.value)}
            placeholder={copy.addressHint}
            value={user}
          />
        </label>
        <label>
          {copy.credential}
          <NativeAdminPassword
            disabled={busy || !original}
            label={copy.credential}
            onChange={setPassword}
            saved={original?.hasPassword}
            value={password}
          />
        </label>
        {busy ? <p role="status">{original ? copy.saving : copy.loading}</p> : null}
        {error ? (
          <p className="cs-error" role="alert">
            {error}
          </p>
        ) : null}
        {error && !original ? (
          <Button onClick={() => setAttempt(value => value + 1)} variant="secondary">
            {copy.refresh}
          </Button>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
      </div>
      <footer className="cs-admin-footer">
        <Button disabled={busy || !original || !runtime.post} onClick={() => void execute(true)} variant="secondary">
          {copy.test}
        </Button>
        <Button disabled={busy || !original || !runtime.post} onClick={() => void execute(false)}>
          {copy.save}
        </Button>
      </footer>
    </NativeAdminDialog>
  )
}
