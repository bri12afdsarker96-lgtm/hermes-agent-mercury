import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { nativeBusinessAdminCopy } from '@/i18n/native-business-admin'

import type { ShopBrowserProfile } from '../../electron/shop-browser-types'

import { NativeAdminDialog, NativeAdminPassword } from './native-admin-dialog'
import {
  businessAdminErrorKey,
  nativeBusinessAdminApi,
  nativeSubAccountEmail,
  type ShopSubAccount
} from './native-business-admin-api'
import type { EnterpriseClientRuntime } from './runtime'

export function ShopSubAccountsButton({
  runtime,
  profile,
  disabled
}: {
  runtime: EnterpriseClientRuntime
  profile: ShopBrowserProfile
  disabled?: boolean
}) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const [openedFor, setOpenedFor] = useState<EnterpriseClientRuntime>()

  return (
    <>
      <Button data-native-tone="info" disabled={disabled} onClick={() => setOpenedFor(runtime)} variant="secondary">
        {copy.subAccounts}
      </Button>
      {openedFor === runtime ? (
        <SubAccountsList key={profile.id} onClose={() => setOpenedFor(undefined)} profile={profile} runtime={runtime} />
      ) : null}
    </>
  )
}

function SubAccountsList({
  runtime,
  profile,
  onClose
}: {
  runtime: EnterpriseClientRuntime
  profile: ShopBrowserProfile
  onClose(): void
}) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const api = useMemo(() => nativeBusinessAdminApi(runtime), [runtime])
  const scope = useMemo(() => ({ runtime, profileId: profile.id, alive: true, pending: false }), [runtime, profile.id])
  const [rows, setRows] = useState<ShopSubAccount[]>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState<ShopSubAccount | 'new'>()
  const [removing, setRemoving] = useState<ShopSubAccount>()

  useEffect(() => {
    let active = true
    scope.alive = true
    setBusy(true)
    setRows(undefined)
    setError('')
    void api
      .listSubAccounts(profile.id)
      .then(value => {
        if (active) {
          setRows(value)
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
  }, [api, profile.id, scope, attempt, copy])

  async function mutate(row: ShopSubAccount, remove: boolean) {
    if (scope.pending) {
      return
    }

    scope.pending = true
    setBusy(true)
    setError('')

    try {
      if (remove) {
        await api.deleteSubAccount(row)
      } else {
        await api.saveSubAccount({
          id: row.id,
          profileId: profile.id,
          subAccount: row.subAccount,
          enabled: !row.enabled,
          expectedRevision: row.revision
        })
      }

      if (!scope.alive) {
        return
      }

      const fresh = await api.listSubAccounts(profile.id)

      if (!scope.alive) {
        return
      }

      if (
        remove
          ? fresh.some(item => item.id === row.id)
          : !fresh.some(item => item.id === row.id && item.enabled !== row.enabled && item.revision > row.revision)
      ) {
        throw new Error('SHOP_SUBACCOUNT_READBACK_INVALID')
      }

      setRows(fresh)
      setRemoving(undefined)
    } catch (reason) {
      if (scope.alive) {
        setError(copy[businessAdminErrorKey(reason)])

        if ([401, 403, 404].includes((reason as { status?: number }).status ?? 0)) {
          setRows(undefined)
          setRemoving(undefined)
        }
      }
    } finally {
      scope.pending = false

      if (scope.alive) {
        setBusy(false)
      }
    }
  }

  return (
    <>
      <NativeAdminDialog
        busy={busy}
        className="cs-subaccounts-dialog"
        description={copy.subAccountEvidence}
        onClose={onClose}
        open
        title={`${copy.subAccountManagement} - ${profile.shopName || profile.displayName}`}
      >
        <div className="cs-admin-list-toolbar">
          <Button disabled={busy || !rows || !runtime.post} onClick={() => setEditing('new')}>
            {copy.addAccount}
          </Button>
          {error ? (
            <Button disabled={busy} onClick={() => setAttempt(value => value + 1)} variant="secondary">
              {copy.refresh}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="cs-error cs-admin-list-status" role="alert">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p className="cs-admin-list-status" role="status">
            {copy.loading}
          </p>
        ) : null}
        <div className="cs-admin-list-table">
          <table className="cs-table cs-subaccounts-table">
            <colgroup>
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>{copy.sequence}</th>
                <th>{copy.subAccounts}</th>
                <th>{copy.enabled}</th>
                <th>{copy.updated}</th>
                <th>{copy.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map(row => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.subAccount}</td>
                  <td>{row.enabled ? copy.enabled : copy.disabled}</td>
                  <td>{row.updatedAt}</td>
                  <td>
                    <div className="cs-actions">
                      <Button
                        data-native-tone="info"
                        disabled={busy}
                        onClick={() => setEditing(row)}
                        variant="secondary"
                      >
                        {copy.edit}
                      </Button>
                      <Button
                        data-native-tone="amber"
                        disabled={busy || !runtime.post}
                        onClick={() => void mutate(row, false)}
                        variant="secondary"
                      >
                        {row.enabled ? copy.disabled : copy.enabled}
                      </Button>
                      <Button
                        data-native-tone="danger"
                        disabled={busy || !runtime.post}
                        onClick={() => setRemoving(row)}
                        variant="secondary"
                      >
                        {copy.remove}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows?.length === 0 ? <p className="cs-empty">{copy.noAccounts}</p> : null}
        </div>
        <footer className="cs-admin-footer">
          <span>{rows ? copy.totalAccounts.replace('{count}', String(rows.length)) : '—'}</span>
          <Button disabled={busy} onClick={onClose} variant="secondary">
            {copy.close}
          </Button>
        </footer>
      </NativeAdminDialog>
      {editing ? (
        <SubAccountEditor
          key={editing === 'new' ? 'new' : editing.id}
          onClose={() => setEditing(undefined)}
          onSaved={async saved => {
            const fresh = await api.listSubAccounts(profile.id)

            if (!scope.alive) {
              return
            }

            if (!fresh.some(row => row.id === saved.id && row.revision >= saved.revision)) {
              throw new Error('SHOP_SUBACCOUNT_READBACK_INVALID')
            }

            setRows(fresh)
            setEditing(undefined)
          }}
          profileId={profile.id}
          row={editing === 'new' ? undefined : editing}
          runtime={runtime}
        />
      ) : null}
      {removing ? (
        <NativeAdminDialog
          busy={busy}
          className="cs-admin-confirm"
          description={copy.subAccountEvidence}
          onClose={() => setRemoving(undefined)}
          open
          title={copy.remove}
        >
          <p className="cs-admin-form">{copy.deleteAccount.replace('{account}', removing.subAccount)}</p>
          <footer className="cs-admin-footer">
            <Button disabled={busy} onClick={() => setRemoving(undefined)} variant="secondary">
              {copy.cancel}
            </Button>
            <Button disabled={busy} onClick={() => void mutate(removing, true)}>
              {copy.confirm}
            </Button>
          </footer>
        </NativeAdminDialog>
      ) : null}
    </>
  )
}

function SubAccountEditor({
  runtime,
  profileId,
  row,
  onClose,
  onSaved
}: {
  runtime: EnterpriseClientRuntime
  profileId: string
  row?: ShopSubAccount
  onClose(): void
  onSaved(row: ShopSubAccount): Promise<void>
}) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const scope = useMemo(() => ({ runtime, profileId, alive: true, pending: false }), [runtime, profileId])
  const [account, setAccount] = useState(row?.subAccount ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    scope.alive = true

    return () => {
      scope.alive = false
    }
  }, [scope])

  async function save() {
    if (scope.pending) {
      return
    }

    const subAccount = account.trim()

    if (!nativeSubAccountEmail.test(subAccount)) {
      setError(copy.invalidEmail)

      return
    }

    if (!row && !password.trim()) {
      setError(copy.passwordRequired)

      return
    }

    scope.pending = true
    setBusy(true)
    setError('')

    try {
      const saved = await nativeBusinessAdminApi(runtime).saveSubAccount({
        id: row?.id,
        profileId,
        subAccount,
        password: password.trim() || undefined,
        enabled: row?.enabled ?? true,
        expectedRevision: row?.revision ?? 0
      })

      if (scope.alive) {
        await onSaved(saved)
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
      className="cs-subaccount-edit-dialog"
      description={copy.subAccountEvidence}
      onClose={onClose}
      open
      title={row ? copy.editAccount : copy.addAccount}
    >
      <div className="cs-admin-form">
        <label>
          {copy.subAccounts}
          <Input
            autoComplete="off"
            disabled={busy}
            onChange={event => setAccount(event.target.value)}
            placeholder={copy.accountHint}
            value={account}
          />
        </label>
        <label>
          {copy.password}
          <NativeAdminPassword
            disabled={busy}
            label={copy.password}
            onChange={setPassword}
            saved={row?.hasPassword}
            value={password}
          />
        </label>
        {error ? (
          <p className="cs-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer className="cs-admin-footer">
        <Button disabled={busy} onClick={onClose} variant="secondary">
          {copy.cancel}
        </Button>
        <Button disabled={busy || !runtime.post} onClick={() => void save()}>
          {copy.save}
        </Button>
      </footer>
    </NativeAdminDialog>
  )
}
