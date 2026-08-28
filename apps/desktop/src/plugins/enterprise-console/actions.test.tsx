import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { actionError, ConfirmAction, FormAction } from './actions'
import { HermesApiError } from './fetch-transport'

// Radix Dialog uses these in jsdom.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

function wrap(node: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { client, ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>) }
}

afterEach(cleanup)

describe('actionError', () => {
  it('maps codes to friendly, redacted messages', () => {
    expect(actionError(new HermesApiError(401, 'unauthorized', 'x'))).toBe('authentication required')
    expect(actionError(new HermesApiError(403, 'forbidden', 'x'))).toBe('not permitted')
    expect(actionError(new HermesApiError(409, 'error', 'x'))).toContain('conflict')
    expect(actionError(new HermesApiError(0, 'network', 'x'))).toContain('reach')
    expect(actionError(new HermesApiError(501, 'not_implemented', 'x'))).toContain('unavailable')
    expect(actionError(new Error('boom'))).toBe('action failed')
  })
})

function confirmButton() {
  return screen.getByRole('button', { name: /confirm/i })
}

describe('ConfirmAction', () => {
  it('opens a confirm dialog, runs the server write, then invalidates the query', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })

    const { client } = wrap(
      <ConfirmAction invalidateKey={['k']} run={run} testId="act" title="Do it?">
        go
      </ConfirmAction>
    )

    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(screen.getByTestId('act'))
    expect(screen.getByText('Do it?')).toBeTruthy()

    fireEvent.click(confirmButton())

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['k'] }))
  })

  it('does not run the write when the user cancels (no fabricated success)', () => {
    const run = vi.fn().mockResolvedValue({})
    wrap(
      <ConfirmAction run={run} testId="act" title="Do it?">
        go
      </ConfirmAction>
    )

    fireEvent.click(screen.getByTestId('act'))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(run).not.toHaveBeenCalled()
  })

  it('surfaces a 403 and keeps the dialog open (fails closed, no refetch)', async () => {
    const run = vi.fn().mockRejectedValue(new HermesApiError(403, 'forbidden', 'nope'))

    const { client } = wrap(
      <ConfirmAction invalidateKey={['k']} run={run} testId="act" title="Do it?">
        go
      </ConfirmAction>
    )

    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(screen.getByTestId('act'))
    fireEvent.click(confirmButton())

    await waitFor(() => expect(screen.getByText('not permitted')).toBeTruthy())
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('FormAction', () => {
  it('submits, invalidates the query, and closes on success', async () => {
    const submit = vi.fn().mockResolvedValue({})

    const { client } = wrap(
      <FormAction invalidateKey={['k']} submit={submit} testId="f" title="Form" trigger="open">
        <span>body</span>
      </FormAction>
    )

    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(screen.getByTestId('f'))
    expect(screen.getByText('Form')).toBeTruthy()
    fireEvent.click(screen.getByTestId('f-submit'))

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['k'] }))
  })

  it('disables submit when canSubmit is false', () => {
    wrap(
      <FormAction canSubmit={false} submit={vi.fn()} testId="f" title="Form" trigger="open">
        <span>body</span>
      </FormAction>
    )

    fireEvent.click(screen.getByTestId('f'))
    expect((screen.getByTestId('f-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('surfaces an error and keeps the dialog open (no refetch)', async () => {
    const submit = vi.fn().mockRejectedValue(new HermesApiError(409, 'error', 'x'))

    const { client } = wrap(
      <FormAction invalidateKey={['k']} submit={submit} testId="f" title="Form" trigger="open">
        <span>body</span>
      </FormAction>
    )

    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(screen.getByTestId('f'))
    fireEvent.click(screen.getByTestId('f-submit'))

    await waitFor(() => expect(screen.getByTestId('f-error')).toBeTruthy())
    expect(invalidate).not.toHaveBeenCalled()
  })
})
