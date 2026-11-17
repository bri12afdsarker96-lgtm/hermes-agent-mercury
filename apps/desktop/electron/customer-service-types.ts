import type { ShopBrowserProfile } from './shop-browser-types'
import type { ShopPayoutSettings } from './shop-payout-settings'

export interface CustomerRuleDraft {
  id?: string
  name: string
  priority: number
  keywords: string
  reply: string
  enabled: boolean
  matchType: 'keyword_any' | 'exact_match'
  cooldownSeconds: number
  stopProcessing: boolean
  doNotInvite: boolean
  transferHuman: boolean
  processEvaluatedClaim: boolean
}

/** Field names mirror BuyerIntentRuleRow. IDs belong to this local preview. */
export interface CustomerRule {
  id: string
  IntentName: string
  SortOrder: number
  Keywords: string
  ReplyText: string
  Enabled: 0 | 1
  MatchType: 'keyword_any' | 'exact_match'
  ActionsJson: string
  CooldownSeconds: number
  StopProcessing: boolean
}

export interface CustomerSimulationMessage {
  conversationId: string
  messageId: string
  text: string
  timestampMs: number
}

export interface CustomerConversation {
  id: string
  mode: 'auto' | 'pending' | 'waiting_resume'
  version: number
  lastMatched: [string, number][]
}

export interface CustomerPendingTask {
  id: string
  conversationId: string
  reason: string
  status: 'pending' | 'completed'
  seen: boolean
  createdAt: number
  completedAt?: number
}

export interface CustomerServiceEvent {
  id: string
  at: number
  conversationId: string
  messageId?: string
  action: string
  detail: string
  payoutSettings?: ShopPayoutSettings
}

export interface CustomerServiceSnapshot {
  revision: number
  profile: ShopBrowserProfile
  rules: CustomerRule[]
  conversations: CustomerConversation[]
  tasks: CustomerPendingTask[]
  events: CustomerServiceEvent[]
}

export interface CustomerServiceRulesSnapshot {
  revision: number
  profile: ShopBrowserProfile
  rules: CustomerRule[]
}

export interface CustomerServiceRequest {
  sessionId: string
  profileId: string
  action: 'snapshot' | 'rulesSnapshot' | 'saveRule' | 'deleteRule' | 'simulate' | 'seen' | 'complete' | 'resume'
  rulesOnly?: boolean
  expectedRevision?: number
  rule?: CustomerRuleDraft
  ruleId?: string
  message?: CustomerSimulationMessage
  taskId?: string
  conversationId?: string
  reason?: string
}

export interface CustomerServiceReply {
  ok: boolean
  error?: string
  snapshot?: CustomerServiceSnapshot
  rulesSnapshot?: CustomerServiceRulesSnapshot
  duplicate?: boolean
}
