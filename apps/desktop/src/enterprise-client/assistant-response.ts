/**
 * The Enterprise AI endpoint is the authority for answer text, retrieval
 * diagnostics and optional customer-facing reply cards.  Keep all parsing in
 * one place so the normal assistant and customer-reply workspace cannot drift
 * when the service adds a backwards-compatible field.
 */

export type CustomerReplyOptionKind = 'alternative_reply' | 'current_reply' | 'follow_up'

export interface CustomerReplyOption {
  kind: CustomerReplyOptionKind
  text: string
}

export interface KnowledgeTrace {
  bestSimilarity?: number
  candidateCount: number
  resultCount: number
  similarityThreshold?: number
  status?: string
}

export interface AssistantPresentation {
  customerReplyOptions: CustomerReplyOption[]
  knowledgeTrace?: KnowledgeTrace
  reasoningSummary?: string
  text: string
}

/** Suppress only exact duplicate text; distinct server-authored suggestions stay visible. */
export function supplementaryReplyOptions(text: string, options: CustomerReplyOption[] = []): CustomerReplyOption[] {
  const normalized = (value: string) => value.replace(/\s+/g, ' ').trim()
  const seen = new Set([normalized(text)])
  return options.filter(option => {
    const value = normalized(option.text)
    if (!value || seen.has(value)) {return false}
    seen.add(value)
    return true
  })
}

const MAX_ANSWER_CHARS = 80_000
const MAX_OPTION_CHARS = 2_000
const MAX_OPTIONS = 3
const MAX_REASONING_SUMMARY_CHARS = 800
const OPTION_KINDS = new Set<CustomerReplyOptionKind>(['current_reply', 'follow_up', 'alternative_reply'])

function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function boundedCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
}

function boundedSimilarity(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined
}

function normalizeReplyOptions(value: unknown): CustomerReplyOption[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const options: CustomerReplyOption[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || options.length >= MAX_OPTIONS) {
      continue
    }

    const candidate = item as { kind?: unknown; text?: unknown }
    const kind = candidate.kind
    const text = boundedText(candidate.text, MAX_OPTION_CHARS)
    if (typeof kind !== 'string' || !OPTION_KINDS.has(kind as CustomerReplyOptionKind) || !text || seen.has(text)) {
      continue
    }

    seen.add(text)
    options.push({ kind: kind as CustomerReplyOptionKind, text })
  }

  return options
}

function legacyTrace(value: unknown): KnowledgeTrace | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const completedSearch = value.find(item => {
    if (!item || typeof item !== 'object') {
      return false
    }
    const candidate = item as { status?: unknown; tool?: unknown }
    return candidate.status === 'completed' && candidate.tool === 'enterprise_knowledge.search'
  })
  if (!completedSearch || typeof completedSearch !== 'object') {
    return undefined
  }

  const trace = completedSearch as {
    best_similarity?: unknown
    candidate_count?: unknown
    result_count?: unknown
    similarity_threshold?: unknown
    status?: unknown
  }
  const resultCount = boundedCount(trace.result_count)
  if (resultCount === undefined) {
    return undefined
  }

  return {
    candidateCount: boundedCount(trace.candidate_count) ?? 0,
    resultCount,
    ...(boundedSimilarity(trace.best_similarity) !== undefined ? { bestSimilarity: boundedSimilarity(trace.best_similarity) } : {}),
    ...(boundedSimilarity(trace.similarity_threshold) !== undefined ? { similarityThreshold: boundedSimilarity(trace.similarity_threshold) } : {}),
    ...(typeof trace.status === 'string' ? { status: trace.status.slice(0, 48) } : {})
  }
}

function retrievalTrace(value: unknown): KnowledgeTrace | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const meta = value as {
    best_similarity?: unknown
    candidate_count?: unknown
    matched_count?: unknown
    similarity_threshold?: unknown
    status?: unknown
  }
  const resultCount = boundedCount(meta.matched_count)
  if (resultCount === undefined) {
    return undefined
  }

  return {
    candidateCount: boundedCount(meta.candidate_count) ?? 0,
    resultCount,
    ...(boundedSimilarity(meta.best_similarity) !== undefined ? { bestSimilarity: boundedSimilarity(meta.best_similarity) } : {}),
    ...(boundedSimilarity(meta.similarity_threshold) !== undefined ? { similarityThreshold: boundedSimilarity(meta.similarity_threshold) } : {}),
    ...(typeof meta.status === 'string' ? { status: meta.status.slice(0, 48) } : {})
  }
}

/**
 * Accept the current server contract and its existing `text` / `agent_trace`
 * aliases.  The aliases remain necessary for a rolling server upgrade, while
 * preferring the structured fields means an updated server cannot silently
 * lose its answer guidance on desktop.
 */
export function assistantPresentationFrom(value: unknown): AssistantPresentation {
  const response = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const structuredText = boundedText(response.answer_text, MAX_ANSWER_CHARS)
  const knowledgeTrace = retrievalTrace(response.retrieval_meta) ?? legacyTrace(response.agent_trace)
  const reasoningSummary = boundedText(response.reasoning_summary, MAX_REASONING_SUMMARY_CHARS)

  return {
    customerReplyOptions: normalizeReplyOptions(response.customer_reply_options),
    ...(knowledgeTrace ? { knowledgeTrace } : {}),
    ...(reasoningSummary ? { reasoningSummary } : {}),
    text: structuredText || boundedText(response.text, MAX_ANSWER_CHARS)
  }
}
