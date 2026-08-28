/**
 * Control-action helpers — reuse the existing `ConfirmDialog` (which owns the
 * pending → done → close beat and inline error) + React Query invalidation. No
 * new modal / form / toast / mutation framework.
 *
 * The server owns all authority: an action posts to the server, and on success
 * the query is invalidated so the UI shows the AUTHORITATIVE refetch — never a
 * locally fabricated success. Errors (401/403/409/unavailable) surface in the
 * dialog and keep it open.
 */

import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { type FormEvent, type ReactNode, useState } from 'react'

import { hasPermission } from './capabilities'
import { HermesApiError } from './fetch-transport'
import { $whoami } from './session'

export function actionError(err: unknown): string {
  if (err instanceof HermesApiError) {
    if (err.code === 'unauthorized') {
      return 'authentication required'
    }

    if (err.code === 'forbidden') {
      return 'not permitted'
    }

    if (err.code === 'not_implemented') {
      return 'server module unavailable'
    }

    if (err.code === 'network') {
      return 'cannot reach the server'
    }

    if (err.status === 409) {
      return 'conflict — the server rejected this state change'
    }

    return err.message
  }

  return 'action failed'
}

/** A button that confirms, runs a server write, then invalidates a query. */
export function ConfirmAction({
  children,
  description,
  destructive = false,
  disabled = false,
  invalidateKey,
  permission,
  run,
  testId,
  title
}: {
  children: ReactNode
  description?: ReactNode
  destructive?: boolean
  disabled?: boolean
  invalidateKey?: readonly unknown[]
  permission?: string
  run: () => Promise<unknown>
  testId?: string
  title: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const who = useValue($whoami)
  // Pages render only below ConsoleShell's authenticated gate. Keeping direct
  // component mounts permissive preserves isolated UI tests; a real whoami is
  // always required before production action affordances are shown.
  const allowed = !permission || who === null || hasPermission(who, permission)

  if (!allowed) {
    return null
  }

  return (
    <>
      <Button
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="sm"
        variant={destructive ? 'destructive' : 'ghost'}
      >
        {children}
      </Button>
      <ConfirmDialog
        description={description}
        destructive={destructive}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          try {
            await run()
          } catch (err) {
            // Surfaced inline by ConfirmDialog; the dialog stays open.
            throw new Error(actionError(err))
          }

          if (invalidateKey) {
            await queryClient.invalidateQueries({ queryKey: invalidateKey })
          }
        }}
        open={open}
        title={title}
      />
    </>
  )
}

/**
 * A form action in a dialog — reuses the existing Dialog + form primitives. The
 * caller owns the controlled fields (passed as children) and the submit body;
 * this owns open/busy/error, posts to the server, invalidates on success, and
 * closes. Errors surface inline and keep the dialog open (fail closed). Secrets
 * live only in the caller's field state and the request body — never logged.
 */
export function FormAction({
  canSubmit = true,
  children,
  invalidateKey,
  onSuccess,
  permission,
  submit,
  submitLabel = 'Submit',
  testId,
  title,
  trigger
}: {
  canSubmit?: boolean
  children: ReactNode
  invalidateKey?: readonly unknown[]
  onSuccess?: () => void
  permission?: string
  submit: () => Promise<unknown>
  submitLabel?: string
  testId?: string
  title: ReactNode
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const queryClient = useQueryClient()
  const who = useValue($whoami)
  const allowed = !permission || who === null || hasPermission(who, permission)

  if (!allowed) {
    return null
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()

    if (busy || !canSubmit) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await submit()

      if (invalidateKey) {
        await queryClient.invalidateQueries({ queryKey: invalidateKey })
      }

      onSuccess?.()
      setOpen(false)
    } catch (err) {
      setError(actionError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button data-testid={testId} onClick={() => setOpen(true)} size="sm" variant="ghost">
        {trigger}
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-2" onSubmit={onSubmit}>
            {children}
            {error ? (
              <div className="text-xs text-destructive" data-testid={testId ? `${testId}-error` : undefined}>
                {error}
              </div>
            ) : null}
            <DialogFooter>
              <Button data-testid={testId ? `${testId}-submit` : undefined} disabled={busy || !canSubmit} type="submit">
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
