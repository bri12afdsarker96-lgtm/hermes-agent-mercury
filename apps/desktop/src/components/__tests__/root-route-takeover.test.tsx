/**
 * RootRouteTakeover tests — the enterprise first-paint redirect.
 *
 * Contracts:
 *  - an upstream chat root ('', '#/', '#/new', '#/chat') is rewritten to
 *    '#/console' exactly once (a later deliberate chat navigation is NOT
 *    bounced);
 *  - the rewrite is a hash ASSIGNMENT (router-visible) — a replaceState
 *    rewrite is invisible to react-router and leaves the upstream chat on
 *    screen, which was the release-blocking cold-start defect (REM-02).
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RootRouteTakeover } from '../root-route-takeover'

describe('RootRouteTakeover', () => {
  beforeEach(() => {
    window.location.hash = '#/'
  })

  afterEach(() => {
    cleanup()
    window.location.hash = '#/'
  })

  it('rewrites an upstream chat root to #/console via a router-visible hash assignment', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

    try {
      render(<RootRouteTakeover />)

      expect(window.location.hash).toBe('#/console')
      // replaceState must not be the mechanism: it fires neither popstate nor
      // hashchange, so the router would never see the rewrite.
      expect(replaceStateSpy).not.toHaveBeenCalled()
    } finally {
      replaceStateSpy.mockRestore()
    }
  })

  it('leaves non-chat roots alone', () => {
    window.location.hash = '#/settings'

    render(<RootRouteTakeover />)

    expect(window.location.hash).toBe('#/settings')
  })

  it('applies once — a later deliberate chat navigation is not bounced', () => {
    const { rerender } = render(<RootRouteTakeover />)

    expect(window.location.hash).toBe('#/console')

    // User navigates to the chat (the Enterprise Assistant re-home entry).
    window.location.hash = '#/'
    rerender(<RootRouteTakeover />)

    expect(window.location.hash).toBe('#/')
  })
})
