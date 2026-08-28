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

import { Button, ConfirmDialog, useQueryClient } from '@hermes/plugin-sdk'
import { type ReactNode, useState } from 'react'

import { HermesApiError } from './fetch-transport'

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
  run,
  testId,
  title
}: {
  children: ReactNode
  description?: ReactNode
  destructive?: boolean
  disabled?: boolean
  invalidateKey?: readonly unknown[]
  run: () => Promise<unknown>
  testId?: string
  title: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

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
