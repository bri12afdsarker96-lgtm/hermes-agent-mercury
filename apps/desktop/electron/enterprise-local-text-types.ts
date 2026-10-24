/** Public IPC assertions/results only. No credentials, paths or runtime imports. */
export interface LocalTextChoice {
  backend_id: 'codex'
  configuration_id: string
  configuration_version: number
  model: 'gpt-6-luna'
  runtime_protocol: 'codex_responses'
  reasoning_effort: 'medium'
  availability: 'available'
}

export interface LocalTextRequest {
  sessionId: string
  action: 'status' | 'connect' | 'checkModel' | 'cancelLogin' | 'logout' | 'submit' | 'requestStatus' | 'stop'
  conversationId?: string
  requestId?: string
  content?: string
  personaId?: string
  choice?: LocalTextChoice
  mode?: 'summarize' | 'knowledge_answer'
  customerId?: string
  workspaceRevision?: number
  customerOwnerId?: string
  conversationRevision?: number
  knowledgeQuery?: string
  replyPreferences?: {
    tone: 'professional' | 'warm'
    length: 'concise' | 'balanced' | 'detailed'
    address: 'nin' | 'ni'
  }
}

export interface LocalTextReply {
  state: string
  modelStatus?: 'unverified' | 'checking' | 'supported' | 'unsupported' | 'unconfirmed'
  reason?: string
  authUrl?: string
  choice?: LocalTextChoice
  backend_choice?: LocalTextChoice
  text?: string
  requestId?: string
}
