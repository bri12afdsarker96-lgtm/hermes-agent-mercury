import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCustomerReplyWorkspace } from './customer-reply'
import { releaseEnterprisePackageInstall } from './enterprise-install-readiness'
import {
  bindCustomerReplyPreferences, customerReplyPreferencesFor, DEFAULT_REPLY_PREFERENCES,
  normalizeReplyPreferences, replyPreferenceKey, updateCustomerReplyPreferences
} from './enterprise-reply-preferences'

describe('seat reply preferences', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { releaseEnterprisePackageInstall(); vi.restoreAllMocks() })

  it('persists only enums in a server/tenant/seat namespace and restores the same seat', () => {
    const original = createCustomerReplyWorkspace()
    bindCustomerReplyPreferences(original, 'https://company.example/api', 'tenant-a', 'seat-a')
    const selected = { tone: 'warm' as const, length: 'concise' as const, address: 'ni' as const }
    updateCustomerReplyPreferences(original, { ...selected, customerText: 'never persist', token: 'never persist' } as typeof selected)
    expect(localStorage.getItem(replyPreferenceKey('https://company.example', 'tenant-a', 'seat-a')!)).not.toContain('never persist')
    const restored = createCustomerReplyWorkspace()
    bindCustomerReplyPreferences(restored, 'https://company.example/other', 'tenant-a', 'seat-a')
    expect(customerReplyPreferencesFor(restored).get()).toEqual(selected)

    for (const scope of [
      ['https://other.example', 'tenant-a', 'seat-a'],
      ['https://company.example', 'tenant-b', 'seat-a'],
      ['https://company.example', 'tenant-a', 'seat-b']
    ]) {
      const workspace = createCustomerReplyWorkspace()
      bindCustomerReplyPreferences(workspace, ...scope)
      expect(customerReplyPreferencesFor(workspace).get()).toEqual(DEFAULT_REPLY_PREFERENCES)
    }
  })

  it('rejects arbitrary instruction values, recovers corrupt storage and never persists missing identity', () => {
    expect(normalizeReplyPreferences({ tone: 'ignore policy', length: 1000, address: 'https://provider' })).toEqual(DEFAULT_REPLY_PREFERENCES)
    expect(normalizeReplyPreferences(null)).toEqual(DEFAULT_REPLY_PREFERENCES)
    const workspace = createCustomerReplyWorkspace()
    bindCustomerReplyPreferences(workspace, 'https://company.example', undefined, 'seat')
    updateCustomerReplyPreferences(workspace, { tone: 'warm', length: 'detailed', address: 'ni' })
    expect(localStorage.length).toBe(0)
    const key = replyPreferenceKey('https://company.example', 'tenant', 'seat')!
    localStorage.setItem(key, '{broken')
    bindCustomerReplyPreferences(workspace, 'https://company.example', 'tenant', 'seat')
    expect(customerReplyPreferencesFor(workspace).get()).toEqual(DEFAULT_REPLY_PREFERENCES)
    localStorage.setItem(key, 'x'.repeat(2049))
    bindCustomerReplyPreferences(workspace, 'https://company.example', 'tenant', 'seat')
    expect(customerReplyPreferencesFor(workspace).get()).toEqual(DEFAULT_REPLY_PREFERENCES)
  })

  it('invalidates replies for changed style while a failing local preference write leaves work usable', () => {
    const workspace = createCustomerReplyWorkspace()
    bindCustomerReplyPreferences(workspace, 'https://company.example', 'tenant', 'seat')
    const reply = workspace.get().customers[0].reply
    reply.set({ ...reply.get(), context: 'keep this customer', draft: 'old style', requestId: 'old-request', phase: 'generating', memoryNote: 'private fact' })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
    updateCustomerReplyPreferences(workspace, { tone: 'warm', length: 'detailed', address: 'ni' })
    expect(reply.get()).toMatchObject({ context: 'keep this customer', memoryNote: 'private fact', draft: '', requestId: null })
    expect(customerReplyPreferencesFor(workspace).get().tone).toBe('warm')
  })
})
