/**
 * Follow-up page — a11y / keyboard test (P1 Responsive/A11y, current head).
 *
 * Follow-up is an ACTIVE P1 nav surface with responsive coverage but no a11y
 * column; this closes it:
 *  - page heading level-1, panel headings level-2;
 *  - the status filter select has an accessible name (sr-only label);
 *  - each list row is a real button with a stable name and aria-expanded
 *    selection state;
 *  - status is text + dot, never color-only;
 *  - empty state copy is informative.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { FollowupView } from './page-followup.view'
import {
  FOLLOWUP_STATUS_VALUES,
  type FollowupListRowView,
  type FollowupListView
} from './page-followup.view-model'

function row(partial: Partial<FollowupListRowView>): FollowupListRowView {
  return {
    amount: '500',
    businessSubject: '4031 群收款确认',
    businessTeam: null,
    currency: '¥',
    expectedReceiveDate: '2026-08-15',
    followupId: 'f1',
    followupType: 'collection',
    ownerPrincipalId: 'p1',
    receivedAt: '',
    status: 'followup_due',
    statusTone: 'warn',
    ...partial
  }
}

function list(rows: FollowupListRowView[]): FollowupListView {
  return { isEmpty: rows.length === 0, rows }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function viewProps(partial: { list?: FollowupListView; rightPane?: ReactNode; selectedId?: null | string }) {
  return {
    isReady: true,
    list: partial.list ?? list([row({})]),
    listError: null,
    listPending: false,
    onClearSelection: () => undefined,
    onSelect: () => undefined,
    onStatusChange: () => undefined,
    rightPane: partial.rightPane ?? null,
    selectedId: partial.selectedId ?? null,
    status: '' as const,
    statusOptions: FOLLOWUP_STATUS_VALUES,
    title: 'Business Follow-up'
  }
}

afterEach(cleanup)

describe('Follow-up a11y (P1 Responsive/A11y)', () => {
  it('page title is a level-1 heading and panel titles are level-2', () => {
    wrap(<FollowupView {...viewProps({})} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Business Follow-up' })).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Follow-ups' })).not.toBeNull()
  })

  it('status filter select has an accessible name via its sr-only label', () => {
    wrap(<FollowupView {...viewProps({})} />)

    expect(screen.getByLabelText('status filter')).not.toBeNull()
    expect(screen.getByTestId('console-followup-status-filter').tagName.toLowerCase()).toBe('select')
  })

  it('each follow-up row is a button with a stable name and aria-expanded selection state', () => {
    wrap(<FollowupView {...viewProps({ selectedId: 'f1' })} />)

    const button = screen.getByRole('button', { name: /4031 群收款确认/ })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.tagName.toLowerCase()).toBe('button')
  })

  it('status is text + dot, never color-only', () => {
    wrap(<FollowupView {...viewProps({ list: list([row({ status: 'waiting_update' })]) })} />)

    expect(within(screen.getByTestId('console-followup-f1')).getByText('waiting_update')).not.toBeNull()
  })

  it('empty state copy is informative', () => {
    wrap(<FollowupView {...viewProps({ list: list([]) })} />)

    expect(screen.getByText('no follow-ups')).not.toBeNull()
  })

  it('no-selection detail placeholder is readable text, not a blank panel', () => {
    wrap(<FollowupView {...viewProps({})} />)

    expect(screen.getByText(/Select a follow-up to inspect/)).not.toBeNull()
  })
})
