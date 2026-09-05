/**
 * Login surface — responsive hooks (P1 Responsive/A11y, current head).
 *
 * jsdom runs no layout, so these are the repo-standard class-hook assertions:
 * the Login must never crush, clip, or overflow its primary action at any
 * authoritative desktop viewport. Rendered geometry for 1280×720 / 1440×900 /
 * 1672×941 / 1920×1080 is proven separately by the packaged CDP probe
 * (untracked local evidence).
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $connectError, $connecting, $sessionState } from './session'

vi.mock('./one-login', () => ({ reprobeEnterpriseSession: () => undefined }))

import { EnterpriseLogin } from './login'

beforeEach(() => {
  $sessionState.set('UNKNOWN')
  $connecting.set(false)
  $connectError.set(null)
})

afterEach(() => {
  cleanup()
  $sessionState.set('UNKNOWN')
  $connecting.set(false)
  $connectError.set(null)
})

describe('Login responsive hooks (P1 Responsive/A11y)', () => {
  it('root is a full-height column that never overflows the window', () => {
    render(<EnterpriseLogin />)

    const root = screen.getByTestId('enterprise-login')
    expect(root.className).toContain('flex h-full min-h-0 flex-col')
  })

  it('two-panel row carries min-h-0 so children can shrink instead of overflow', () => {
    render(<EnterpriseLogin />)

    const row = rootRow()
    expect(row.className).toContain('flex min-h-0 flex-1')
  })

  it('sign-in panel is full-width below md and 46% above — never crushed', () => {
    render(<EnterpriseLogin />)

    const panel = screen.getByTestId('enterprise-login-session').closest('div.w-full')
    expect(panel).not.toBeNull()
    expect(panel!.className).toContain('w-full')
    expect(panel!.className).toContain('md:w-[46%]')
    expect(panel!.className).toContain('min-w-0')
  })

  it('brand panel hides below md instead of crushing the form', () => {
    render(<EnterpriseLogin />)

    const brand = screen.getByTestId('enterprise-login-brand')
    expect(brand.className).toContain('hidden')
    expect(brand.className).toContain('md:flex')
    expect(brand.className).toContain('min-h-0')
    expect(brand.className).toContain('flex-1')
  })

  it('primary and retry actions span full panel width — no clipped action', () => {
    render(<EnterpriseLogin />)

    const primary = screen.getByTestId('enterprise-login-primary')
    const retry = screen.getByTestId('enterprise-login-retry')
    expect(primary.className).toContain('w-full')
    expect(retry.className).toContain('w-full')
  })

  it('long state copy truncates into the status row instead of stretching the frame', () => {
    render(<EnterpriseLogin />)

    const status = screen.getByTestId('enterprise-login-session')
    const body = status.querySelector('.min-w-0')
    expect(body).not.toBeNull()
  })
})

function rootRow(): HTMLElement {
  const root = screen.getByTestId('enterprise-login')
  return root.querySelector(':scope > div') as HTMLElement
}
