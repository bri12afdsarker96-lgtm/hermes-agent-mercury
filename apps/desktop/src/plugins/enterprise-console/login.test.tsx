/**
 * EnterpriseLogin tests (R5-B) — the Design-System Login/bootstrap surface.
 *
 * Contracts under test:
 *  - the unauthenticated first paint is the Login surface (brand panel + form);
 *  - the FSM state is reported honestly (UNKNOWN / UNAVAILABLE / REVOKED);
 *  - the primary + retry actions reuse the main-owned native-session seam
 *    (`reprobeEnterpriseSession`) — no second auth system;
 *  - NO credential inputs exist in the renderer (no fake login);
 *  - the status region is announced (aria-live).
 *
 * i18n note: without a registered plugin bundle the translator falls back to
 * the raw key (same convention as the console tests), so copy assertions use
 * the raw `login.state.*` keys.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $connectError, $connecting, $sessionState } from './session'

const reprobeMock = vi.fn()

vi.mock('./one-login', () => ({
  reprobeEnterpriseSession: (...args: unknown[]) => reprobeMock(...args)
}))

import { EnterpriseLogin } from './login'

beforeEach(() => {
  reprobeMock.mockReset()
  $sessionState.set('UNKNOWN')
  $connecting.set(false)
  $connectError.set(null)
})

afterEach(() => {
  $sessionState.set('UNKNOWN')
  $connecting.set(false)
  $connectError.set(null)
})

describe('EnterpriseLogin', () => {
  it('renders the Design-System login surface with brand + sign-in panels', () => {
    render(<EnterpriseLogin />)

    expect(screen.getByTestId('enterprise-login')).not.toBeNull()
    expect(screen.getByTestId('enterprise-login-brand')).not.toBeNull()
    expect(screen.getByTestId('enterprise-login-session')).not.toBeNull()
    expect(screen.getByTestId('enterprise-login-primary')).not.toBeNull()
    expect(screen.getByTestId('enterprise-login-retry')).not.toBeNull()
  })

  it('has NO credential inputs — the renderer holds no URL and no token', () => {
    render(<EnterpriseLogin />)

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('password')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('reports UNKNOWN honestly (no native session yet)', () => {
    render(<EnterpriseLogin />)

    expect(screen.getByTestId('enterprise-login').getAttribute('data-session-state')).toBe('unknown')
    expect(screen.getByText('login.state.unknown')).not.toBeNull()
  })

  it('reports UNAVAILABLE honestly (transient outage, not a revocation)', () => {
    $sessionState.set('UNAVAILABLE')
    render(<EnterpriseLogin />)

    expect(screen.getByTestId('enterprise-login').getAttribute('data-session-state')).toBe('unavailable')
    expect(screen.getByText('login.state.unavailable')).not.toBeNull()
  })

  it('reports REVOKED honestly (federated authority rejected the session)', () => {
    $sessionState.set('REVOKED')
    render(<EnterpriseLogin />)

    expect(screen.getByTestId('enterprise-login').getAttribute('data-session-state')).toBe('revoked')
    expect(screen.getByText('login.state.revoked')).not.toBeNull()
  })

  it('primary action re-probes the main-owned native session seam', () => {
    render(<EnterpriseLogin />)

    fireEvent.click(screen.getByTestId('enterprise-login-primary'))

    expect(reprobeMock).toHaveBeenCalledTimes(1)
  })

  it('retry action reuses the SAME native-session seam (no second auth)', () => {
    render(<EnterpriseLogin />)

    fireEvent.click(screen.getByTestId('enterprise-login-retry'))

    expect(reprobeMock).toHaveBeenCalledTimes(1)
  })

  it('disables both actions while a probe is in flight', () => {
    $connecting.set(true)
    render(<EnterpriseLogin />)

    expect(screen.getByTestId('enterprise-login-primary').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('enterprise-login-retry').hasAttribute('disabled')).toBe(true)
  })

  it('announces session status through a live region', () => {
    render(<EnterpriseLogin />)

    expect(screen.getByTestId('enterprise-login-session').getAttribute('aria-live')).toBe('polite')
  })
})
