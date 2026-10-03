import { useCallback, useId, useRef, useState } from 'react'
import { useWebPresentation } from './web-presentation'
import { useStore } from '@nanostores/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EnterpriseModalDialog } from './enterprise-design-system'
import { $enterprisePackageInstallFrozen } from './enterprise-install-readiness'
import { useDeliveryCopy } from './delivery-copy'
import { useDeliveryWork } from './use-delivery-work'
import type { EnterpriseClientRuntime } from './runtime'

export function AccountControls({
  runtime,
  onLogout
}: {
  runtime: EnterpriseClientRuntime
  onLogout(): Promise<void>
}) {
  const copy = useDeliveryCopy()
  const web = useWebPresentation()
  const fieldId = useId()
  const frozen = useStore($enterprisePackageInstallFrozen)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const locked = useRef(false)
  useDeliveryWork(busy || Boolean(current || password || confirm))
  const close = useCallback(() => {
    if (locked.current) {
      return
    }
    setCurrent('')
    setPassword('')
    setConfirm('')
    setError('')
    setOpen(false)
  }, [])
  const change = async () => {
    if (
      locked.current ||
      frozen ||
      !runtime.post ||
      password.length < 6 ||
      password !== confirm ||
      current === password ||
      !current
    ) {
      return
    }
    locked.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const body = { current_password: current, new_password: password }
    setCurrent('')
    setPassword('')
    setConfirm('')
    try {
      // Main consumes the rotated bearer. No token ever enters this component.
      await runtime.post('/api/password-change', body)
      setNotice(copy.passwordSaved)
    } catch {
      setError(copy.failed)
    } finally {
      body.current_password = ''
      body.new_password = ''
      locked.current = false
      setBusy(false)
    }
  }
  const logout = async () => {
    if (locked.current || frozen) {
      return
    }
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await onLogout()
    } catch {
      setError(copy.failed)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={frozen}
        onClick={() => {
          setNotice('')
          setOpen(true)
        }}
      >
        {copy.account}
      </Button>
      {open ? (
        <EnterpriseModalDialog label={copy.account} onClose={close}>
          <div className="hesc-panel-heading">
            <h2>{copy.account}</h2>
            <Button aria-label={copy.close} size="icon-sm" variant="ghost" disabled={busy} onClick={close}>
              ×
            </Button>
          </div>
          <form
            className="hesc-delivery-form"
            onSubmit={event => {
              event.preventDefault()
              void change()
            }}
          >
            <p>{copy.passwordHint}</p>
            <label>
              {copy.currentPassword}
              <Input
                autoComplete="current-password"
                aria-label={web.enabled ? copy.currentPassword : undefined}
                type="password"
                value={current}
                aria-invalid={web.enabled && !busy && !current || undefined}
                aria-describedby={web.enabled ? `${fieldId}-current` : undefined}
                disabled={busy || frozen}
                onChange={event => setCurrent(event.target.value)}
              />
              {web.enabled ? <small id={`${fieldId}-current`} className={!current && !busy ? 'web-field-error' : undefined}>{web.words.current}</small> : null}
            </label>
            <label>
              {copy.newPassword}
              <Input
                autoComplete="new-password"
                type="password"
                value={password}
                aria-label={web.enabled ? copy.newPassword : undefined}
                aria-invalid={web.enabled && !busy && (password.length < 6 || current === password) || undefined}
                aria-describedby={web.enabled ? `${fieldId}-password` : undefined}
                disabled={busy || frozen}
                onChange={event => setPassword(event.target.value)}
              />
              {web.enabled ? <small id={`${fieldId}-password`} className={!busy && (password.length < 6 || current === password) ? 'web-field-error' : undefined}>{web.words.password}</small> : null}
            </label>
            <label>
              {copy.confirmPassword}
              <Input
                autoComplete="new-password"
                type="password"
                value={confirm}
                aria-label={web.enabled ? copy.confirmPassword : undefined}
                aria-invalid={web.enabled && !busy && (!confirm || password !== confirm) || undefined}
                aria-describedby={web.enabled ? `${fieldId}-confirm` : undefined}
                disabled={busy || frozen}
                onChange={event => setConfirm(event.target.value)}
              />
              {web.enabled ? <small id={`${fieldId}-confirm`} className={!busy && (!confirm || password !== confirm) ? 'web-field-error' : undefined}>{web.words.confirm}</small> : null}
            </label>
            <Button
              type="submit"
              disabled={
                busy ||
                frozen ||
                !runtime.post ||
                !current ||
                password.length < 6 ||
                password !== confirm ||
                current === password
              }
            >
              {busy ? copy.working : copy.password}
            </Button>
          </form>
          {notice ? <p role="status">{notice}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          <p>{copy.logoutHint}</p>
          <div className="hesc-dialog-actions">
            <Button variant="outline" disabled={busy || frozen} onClick={() => void logout()}>
              {copy.logout}
            </Button>
          </div>
        </EnterpriseModalDialog>
      ) : null}
    </>
  )
}
