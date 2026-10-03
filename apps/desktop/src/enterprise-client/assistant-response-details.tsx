import { AssistantReplyCard } from './assistant-reply-card'
import type { CustomerReplyOption, KnowledgeTrace } from './assistant-response'
import { useWebPresentation } from './web-presentation'

interface AssistantResponseDetailsProps {
  customerReplyOptions?: CustomerReplyOption[]
  knowledgeTrace?: KnowledgeTrace
  reasoningSummary?: string
}

function retrievalCopy(trace: KnowledgeTrace): string {
  if (trace.resultCount === 0) {
    return trace.status === 'reindexing'
      ? '知识库索引正在重建，本次未引用企业资料。'
      : trace.status === 'unavailable'
        ? '企业知识检索暂不可用，本次未引用企业资料。'
        : '质量筛选后没有命中可作为依据的企业资料。'
  }

  const parts = [`质量筛选后命中 ${trace.resultCount} 条资料`]
  if (trace.similarityThreshold !== undefined) {
    parts.push(`阈值 ≥ ${trace.similarityThreshold.toFixed(3)}`)
  }
  if (trace.bestSimilarity !== undefined) {
    parts.push(`最高相似度 ${trace.bestSimilarity.toFixed(3)}`)
  }
  if (trace.candidateCount > 0) {
    parts.push(`已比较 ${trace.candidateCount} 条已授权候选`)
  }

  return `${parts.join(' · ')}。`
}

/** Renders only server-provided, normalized answer metadata; it never invents a customer-facing promise. */
export function AssistantResponseDetails({
  customerReplyOptions = [],
  knowledgeTrace,
  reasoningSummary
}: AssistantResponseDetailsProps) {
  const web = useWebPresentation()
  if (!knowledgeTrace && !reasoningSummary && customerReplyOptions.length === 0) {
    return null
  }

  return (
    <div className="hesc-assistant-response-details">
      {knowledgeTrace ? (
        <section aria-label="企业知识检索（本次）">
          <details open={!web.enabled || undefined} className="hesc-response-detail">
            <summary>企业知识检索（本次）</summary>
            <p>{retrievalCopy(knowledgeTrace)}</p>
          </details>
        </section>
      ) : null}
      {reasoningSummary ? (
        <section aria-label="本次处理摘要">
          <details open={!web.enabled || undefined} className="hesc-response-detail">
            <summary>本次处理摘要</summary>
            <p>{reasoningSummary}</p>
          </details>
        </section>
      ) : null}
      {customerReplyOptions.length > 0 ? (
        <div className="hesc-response-options">
          {customerReplyOptions.map((option, index) => (
            <AssistantReplyCard key={`${option.kind}:${index}:${option.text}`} kind={option.kind} text={option.text} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
