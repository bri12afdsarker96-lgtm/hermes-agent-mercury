import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalVerificationBadge } from './local-verification-badge'

afterEach(() => vi.unstubAllGlobals())

it('shows the persistent marker only when main confirms local verification', async () => {
  vi.stubGlobal('hermesDesktop', { isLocalVerification: async () => true })
  const view = render(<LocalVerificationBadge />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('本地联调'))
  view.rerender(<LocalVerificationBadge />)
  expect(screen.getByRole('status').textContent).toBe('本地联调')
})

it('does not label production as local', async () => {
  const check = vi.fn(async () => false)
  vi.stubGlobal('hermesDesktop', { isLocalVerification: check })
  render(<LocalVerificationBadge />)
  await waitFor(() => expect(check).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
})

it('does not present a failed environment check as production', async () => {
  vi.stubGlobal('hermesDesktop', { isLocalVerification: async () => { throw new Error('unavailable') } })
  render(<LocalVerificationBadge />)
  expect(screen.getByRole('status').textContent).toBe('环境未核验')
})
