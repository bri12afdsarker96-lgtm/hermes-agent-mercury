/**
 * Login surface — a11y / keyboard test (P1 Responsive/A11y, current head).
 *
 * The Login is the unauthenticated FIRST PRODUCT FRAME, so its accessibility
 * is a gate-level surface (P9.2). Contracts:
 *  - one level-1 heading names the sign-in purpose;
 *  - the session-status region is a live `role="status"` region (announced);
 *  - both actions carry accessible names and are native buttons (keyboard
 *    reachable, no tabindex surgery);
 *  - NO credential inputs exist (no fake login);
 *  - the decorative brand panel is hidden from the accessibility tree and
 *    contains no focusable content;
 *  - focus is visible through the enterprise focus-visible ring.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $connectError, $connecting, $sessionState } from './session'

const reprobeMock = vi.fn()
vi.mock('./one-login', () => ({ reprobeEnterpriseSession: (...args: unknown[]) => reprobeMock(...args) }))

import { EnterpriseLogin } from './login'

beforeEach(() => {
  reprobeMock.mockReset()
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

describe('Login a11y (P1 Responsive/A11y)', () => {
  it('exposes one level-1 heading naming the sign-in purpose', () => {
    render(<EnterpriseLogin />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).not.toBeNull()
    // Raw key fallback without a registered bundle (same convention as the
    // console tests); the registered en/zh bundles resolve to real copy.
    expect(heading.textContent).toBe('login.title')
  })

  it('announces session state through a live status region', () => {
    render(<EnterpriseLogin />)

    const status = screen.getByTestId('enterprise-login-session')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
  })

  it('both actions are native buttons with stable accessible names', () => {
    render(<EnterpriseLogin />)

    const primary = screen.getByRole('button', { name: 'login.action' })
    const retry = screen.getByRole('button', { name: 'login.retry' })
    expect(primary).not.toBeNull()
    expect(retry).not.toBeNull()
    expect(primary.tagName.toLowerCase()).toBe('button')
    expect(retry.tagName.toLowerCase()).toBe('button')
  })

  it('is keyboard reachable: primary and retry are in the tab order', () => {
    render(<EnterpriseLogin />)

    const primary = screen.getByTestId('enterprise-login-primary')
    const retry = screen.getByTestId('enterprise-login-retry')

    primary.focus()
    expect(document.activeElement).toBe(primary)

    retry.focus()
    expect(document.activeElement).toBe(retry)
  })

  it('activates the native-session reprobe on Enter from the focused button', () => {
    render(<EnterpriseLogin />)

    const primary = screen.getByTestId('enterprise-login-primary')
    primary.focus()
    fireEvent.keyDown(primary, { code: 'Enter', key: 'Enter' })
    fireEvent.click(primary)

    expect(reprobeMock).toHaveBeenCalled()
  })

  it('has NO credential inputs — the renderer owns no URL and no token', () => {
    render(<EnterpriseLogin />)

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('password')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('decorative brand panel is outside the accessibility tree with no focusable content', () => {
    render(<EnterpriseLogin />)

    const brand = screen.getByTestId('enterprise-login-brand')
    expect(brand.getAttribute('aria-hidden')).toBe('true')
    expect(brand.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
  })

  it('status text is not color-only: state label is real text next to the dot', () => {
    $sessionState.set('UNAVAILABLE')
    render(<EnterpriseLogin />)

    expect(screen.getByText('login.state.unavailable')).not.toBeNull()
    expect(screen.getByText('login.state.unavailableBody')).not.toBeNull()
  })
})
