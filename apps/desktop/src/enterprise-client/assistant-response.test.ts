import { describe, expect, it } from 'vitest'

import { assistantPresentationFrom } from './assistant-response'

describe('assistantPresentationFrom', () => {
  it('prefers the current structured response contract and retains every safe presentation field', () => {
    expect(assistantPresentationFrom({
      answer_text: '内部处理结论',
      customer_reply_options: [
        { kind: 'current_reply', text: '您好，我们正在核对订单。' },
        { kind: 'follow_up', text: '核对完成后会第一时间回复您。' },
        { kind: 'alternative_reply', text: '如方便，请补充订单号。' }
      ],
      reasoning_summary: '已结合当前会话和已授权知识整理处理重点。',
      retrieval_meta: {
        best_similarity: 0.913,
        candidate_count: 18,
        matched_count: 2,
        similarity_threshold: 0.822,
        status: 'hit'
      },
      text: '旧兼容字段'
    })).toEqual({
      customerReplyOptions: [
        { kind: 'current_reply', text: '您好，我们正在核对订单。' },
        { kind: 'follow_up', text: '核对完成后会第一时间回复您。' },
        { kind: 'alternative_reply', text: '如方便，请补充订单号。' }
      ],
      knowledgeTrace: {
        bestSimilarity: 0.913,
        candidateCount: 18,
        resultCount: 2,
        similarityThreshold: 0.822,
        status: 'hit'
      },
      reasoningSummary: '已结合当前会话和已授权知识整理处理重点。',
      text: '内部处理结论'
    })
  })

  it('continues to show a rolling deployment response using the text and agent_trace aliases', () => {
    expect(assistantPresentationFrom({
      agent_trace: [{
        best_similarity: 0.7,
        candidate_count: 5,
        result_count: 1,
        similarity_threshold: 0.6,
        status: 'completed',
        tool: 'enterprise_knowledge.search'
      }],
      text: '兼容回答'
    })).toEqual({
      customerReplyOptions: [],
      knowledgeTrace: {
        bestSimilarity: 0.7,
        candidateCount: 5,
        resultCount: 1,
        similarityThreshold: 0.6,
        status: 'completed'
      },
      text: '兼容回答'
    })
  })

  it('drops malformed or unsupported customer-facing options', () => {
    expect(assistantPresentationFrom({
      customer_reply_options: [
        { kind: 'unsafe', text: '不应显示' },
        { kind: 'current_reply', text: '' },
        { kind: 'current_reply', text: '可显示' },
        { kind: 'current_reply', text: '可显示' }
      ],
      retrieval_meta: { matched_count: 'not-a-number' },
      text: '正常回答'
    })).toEqual({ customerReplyOptions: [{ kind: 'current_reply', text: '可显示' }], text: '正常回答' })
  })
})
