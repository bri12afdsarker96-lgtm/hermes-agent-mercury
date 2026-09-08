import { atom, type WritableAtom } from 'nanostores'

import {
  createCustomerReplyWorkspace,
  type CustomerReplyWorkspaceStore,
  invalidateCustomerReplies,
  retireCustomerReplyWorkspace
} from './customer-reply'
import type { EnterpriseClientRuntime } from './runtime'

export type AssistantMode =
  'customer_reply' | 'chat' | 'extract_action_items' | 'knowledge_question' | 'rewrite' | 'summarize'

export interface ConversationMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
}

export interface AssistantSession {
  customerReply: CustomerReplyWorkspaceStore
  id: number
  messages: WritableAtom<ConversationMessage[]>
  mode: WritableAtom<AssistantMode>
  scope: string
}

// Runtime identity is one authenticated main-process session. Navigation may
// reuse it; another login, principal or tenant must never reuse its drafts.
const sessions = new WeakMap<EnterpriseClientRuntime, AssistantSession>()
let nextSessionId = 0

export function releaseAssistantSession(runtime: EnterpriseClientRuntime | null): void {
  if (!runtime) {
    return
  }

  const existing = sessions.get(runtime)

  if (existing) {
    invalidateCustomerReplies(existing.customerReply)
    existing.messages.set([])
    sessions.delete(runtime)
  }
}

export function assistantSessionFor(
  runtime: EnterpriseClientRuntime | null,
  tenantId?: string,
  principalId?: string
): AssistantSession {
  const scope = JSON.stringify([tenantId ?? null, principalId ?? null])
  const existing = runtime ? sessions.get(runtime) : undefined

  if (existing?.scope === scope) {
    return existing
  }

  // Session selection can run during render. Revoke pending work immediately
  // without notifying subscribers on the old, about-to-unmount surface.
  if (existing) {
    retireCustomerReplyWorkspace(existing.customerReply)
  }

  const session = {
    customerReply: createCustomerReplyWorkspace(),
    id: ++nextSessionId,
    messages: atom<ConversationMessage[]>([]),
    mode: atom<AssistantMode>('customer_reply'),
    scope
  }

  if (runtime) {
    sessions.set(runtime, session)
  }

  return session
}
