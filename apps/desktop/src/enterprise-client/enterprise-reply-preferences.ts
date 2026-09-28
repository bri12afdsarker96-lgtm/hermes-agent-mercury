import { atom, type WritableAtom } from 'nanostores'

import type { CustomerReplyWorkspaceStore } from './customer-reply'
import { $enterprisePackageInstallFrozen } from './enterprise-install-readiness'

/** User-frozen for this delivery. Retain staged learning code and saved data;
 * reopening it requires an explicit product decision, not a runtime setting. */
export const ENTERPRISE_LEARNING_ENABLED = false

export interface EnterpriseReplyPreferences {
  tone: 'professional' | 'warm'
  length: 'concise' | 'balanced' | 'detailed'
  address: 'nin' | 'ni'
}

export const DEFAULT_REPLY_PREFERENCES: EnterpriseReplyPreferences = {
  tone: 'professional', length: 'balanced', address: 'nin'
}

interface ReplyPreferences {
  key: string | null
  state: WritableAtom<EnterpriseReplyPreferences>
}

const preferences = new WeakMap<CustomerReplyWorkspaceStore, ReplyPreferences>()

export function replyPreferenceKey(serverOrigin?: string, tenantId?: string, principalId?: string): string | null {
  if (!serverOrigin || !tenantId || !principalId) {return null}

  try {
    const url = new URL(serverOrigin)

    return ['http:', 'https:'].includes(url.protocol)
      ? `hermes-enterprise-reply:v1:${JSON.stringify([url.origin, tenantId, principalId])}`
      : null
  } catch {
    return null
  }
}

export function normalizeReplyPreferences(raw: unknown): EnterpriseReplyPreferences {
  const value = raw && typeof raw === 'object' ? raw as Partial<EnterpriseReplyPreferences> : {}

  return {
    tone: value.tone === 'warm' ? 'warm' : 'professional',
    length: value.length === 'concise' || value.length === 'detailed' ? value.length : 'balanced',
    address: value.address === 'ni' ? 'ni' : 'nin'
  }
}

function preferencesFor(workspace: CustomerReplyWorkspaceStore): ReplyPreferences {
  let entry = preferences.get(workspace)

  if (!entry) {
    entry = { key: null, state: atom({ ...DEFAULT_REPLY_PREFERENCES }) }
    preferences.set(workspace, entry)
  }

  return entry
}

export function customerReplyPreferencesFor(workspace: CustomerReplyWorkspaceStore): WritableAtom<EnterpriseReplyPreferences> {
  return preferencesFor(workspace).state
}

/** Called once by the authenticated session owner, never inferred from a body. */
export function bindCustomerReplyPreferences(workspace: CustomerReplyWorkspaceStore, serverOrigin?: string, tenantId?: string, principalId?: string): void {
  const entry = preferencesFor(workspace)
  const key = replyPreferenceKey(serverOrigin, tenantId, principalId)
  entry.key = key
  let value: unknown = null

  try {
    const raw = key ? localStorage.getItem(key) : null

    if (raw && raw.length <= 2048) {value = JSON.parse(raw)}
  } catch { /* A blocked preference store does not block customer work. */ }

  entry.state.set(normalizeReplyPreferences(value))
}

export function updateCustomerReplyPreferences(workspace: CustomerReplyWorkspaceStore, value: EnterpriseReplyPreferences): void {
  if ($enterprisePackageInstallFrozen.get()) {return}
  const entry = preferencesFor(workspace)
  const next = normalizeReplyPreferences(value)

  if (JSON.stringify(next) === JSON.stringify(entry.state.get())) {return}
  entry.state.set(next)

  // The old reply belongs to the exact preference snapshot that produced it.
  for (const customer of workspace.get().customers) {
    customer.reply.set({ ...customer.reply.get(), draft: '', copiedDraft: null, knowledgeGrounded: null, requestId: null, phase: null })
  }

  try {
    if (entry.key) {localStorage.setItem(entry.key, JSON.stringify(next))}
  } catch { /* Keep this session's enum choice usable when storage is full. */ }
}
