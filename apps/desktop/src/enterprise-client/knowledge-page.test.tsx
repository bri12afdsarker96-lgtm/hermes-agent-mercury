import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { prepareEnterprisePackageInstall, releaseEnterprisePackageInstall } from './enterprise-install-readiness'
import { KnowledgePage } from './knowledge-page'
import type { EnterpriseClientRuntime } from './runtime'

const base = {
  candidate_id: 'candidate-a',
  topic: '员工手册',
  text: '蓝色产品提供七天换货服务。',
  status: 'needs_review',
  risk_level: 'low',
  created_by_principal_id: 'author',
  reviewed_by_principal_id: null,
  kb_state: null,
  retrievable: false,
  publication_stage: null
}

function makeRuntime(response: object, post: (...args: any[]) => Promise<object> = vi.fn(async () => ({})), upload = vi.fn(async () => ({}))) {
  const get = vi.fn(async (path: string) => (path.startsWith('/api/knowledge-candidates') ? response : {}))

  const runtime: EnterpriseClientRuntime = {
    get: get as EnterpriseClientRuntime['get'],
    post: post as NonNullable<EnterpriseClientRuntime['post']>,
    upload: upload as NonNullable<EnterpriseClientRuntime['upload']>,
    disconnect: vi.fn(async () => undefined)
  }

  return { runtime, get, post, upload }
}

describe('KnowledgePage publication authority', () => {
  afterEach(async () => { await act(async () => releaseEnterprisePackageInstall()) })
  it('stages an upload and waits for explicit review submission, without legacy JSONL commit', async () => {
    const post = vi.fn(async () => ({}))

    const upload = vi.fn(async () => ({
      upload_id: 'upload-a',
      filename: '手册.txt',
      total: 1,
      chunks: [{ text: '待核对资料' }]
    }))

    const { runtime } = makeRuntime(
      { candidates: [], permissions: ['kb.upload', 'kb.author'], principal_id: 'author', has_more: false },
      post,
      upload
    )

    const file = new File(['待核对资料'], '手册.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('待核对资料').buffer })
    render(<KnowledgePage runtime={runtime} />)
    await screen.findByRole('button', { name: '上传并预览' })
    fireEvent.change(screen.getByPlaceholderText('例如：员工手册'), { target: { value: '员工手册' } })
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '上传并预览' }))
    await screen.findByText('待核对资料')
    expect(post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/knowledge-submit-review', { upload_id: 'upload-a', topic: '员工手册' })
    )
    expect(post).not.toHaveBeenCalledWith('/api/knowledge-commit', expect.anything())
  })

  it('prevents author self-review and distinguishes approved from retrievable', async () => {
    const { runtime } = makeRuntime({
      candidates: [base],
      permissions: ['kb.candidate.review', 'kb.candidate.publish'],
      principal_id: 'author',
      has_more: false
    })

    render(<KnowledgePage runtime={runtime} />)
    await screen.findByText(base.text)
    expect(screen.queryByRole('button', { name: '通过审核' })).toBeNull()
    expect(screen.queryByRole('button', { name: '发布知识' })).toBeNull()
    expect(screen.queryByText('已发布 · 可用于问答')).toBeNull()
  })

  it('sends review for the selected candidate and retains input after rejection', async () => {
    const post = vi.fn(async () => {
      throw new Error('知识状态已变化，请刷新')
    })

    const { runtime } = makeRuntime(
      { candidates: [base], permissions: ['kb.candidate.review'], principal_id: 'reviewer', has_more: false },
      post
    )

    render(<KnowledgePage runtime={runtime} />)
    await screen.findByRole('button', { name: '通过审核' })
    fireEvent.change(screen.getByLabelText('审核说明'), { target: { value: '已核对' } })
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }))
    await screen.findByText('知识状态已变化，请刷新')
    expect(post).toHaveBeenCalledWith(
      '/api/knowledge-review',
      expect.objectContaining({ candidate_id: 'candidate-a', verdict: 'approved', reason: '已核对' })
    )
    expect((screen.getByLabelText('审核说明') as HTMLTextAreaElement).value).toBe('已核对')
  })

  it('shows withdrawn knowledge as unavailable even though its historical candidate is published', async () => {
    const { runtime } = makeRuntime({
      candidates: [{ ...base, status: 'published', kb_state: 'withdrawn' }],
      permissions: ['kb.delete'],
      principal_id: 'publisher',
      has_more: false
    })

    render(<KnowledgePage runtime={runtime} />)
    expect((await screen.findAllByText('已撤回 · 不参与问答')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '永久删除此知识' })).toBeNull()
    expect(screen.queryByText('已发布 · 可用于问答')).toBeNull()
  })

  it('blocks installation for an unsubmitted file, an in-flight upload and its staged preview', async () => {
    let uploaded!: (value: object) => void
    const upload = vi.fn(() => new Promise<object>(resolve => { uploaded = resolve }))
    const { runtime } = makeRuntime({ candidates: [], permissions: ['kb.upload', 'kb.author'], principal_id: 'author', has_more: false }, vi.fn(async () => ({})), upload)
    render(<KnowledgePage runtime={runtime} />)
    await screen.findByRole('button', { name: '上传并预览' })
    fireEvent.change(screen.getByPlaceholderText('例如：员工手册'), { target: { value: '尚未上传的手册' } })
    const file = new File(['手册内容'], 'handbook.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('手册内容').buffer })
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } })
    await act(async () => { expect((await prepareEnterprisePackageInstall('selected-file')).ready).toBe(false) })
    expect((screen.getByPlaceholderText('例如：员工手册') as HTMLInputElement).value).toBe('尚未上传的手册')
    fireEvent.click(screen.getByRole('button', { name: '上传并预览' }))
    await waitFor(() => expect(upload).toHaveBeenCalledOnce())
    await act(async () => {
      const result = await prepareEnterprisePackageInstall('uploading')
      expect(result.ready).toBe(false)
      expect(result.reasons.join()).toContain('正在上传')
    })
    await act(async () => uploaded({ upload_id: 'staged-a', total: 1, chunks: [{ text: '待提交预览' }] }))
    await screen.findByText('待提交预览')
    await act(async () => { expect((await prepareEnterprisePackageInstall('staged')).ready).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }))
    await screen.findByText(/资料已进入审核队列/)
    await act(async () => { expect((await prepareEnterprisePackageInstall('submitted')).ready).toBe(true) })
    expect((screen.getByRole('button', { name: '上传并预览' }) as HTMLButtonElement).disabled).toBe(true)
  })
})


it('lets the tenant administrator approve their upload and publish only after review succeeds', async () => {
  const post = vi.fn(async () => ({ done: true }))
  const { runtime } = makeRuntime({ candidates: [base], role: 'tenant_admin', permissions: ['kb.candidate.review', 'kb.candidate.publish'], principal_id: 'author', has_more: false }, post)
  render(<KnowledgePage runtime={runtime} />)
  fireEvent.click(await screen.findByRole('button', { name: '审核并发布' }))
  await screen.findByText('审核并发布完成，可用于企业 AI 问答。')
  expect(post.mock.calls).toEqual([
    ['/api/knowledge-review', expect.objectContaining({candidate_id: base.candidate_id, verdict: 'approved'})],
    ['/api/knowledge-publish', expect.objectContaining({candidate_id: base.candidate_id})]
  ])
})

it('stops a batch on failure and retains completed publications', async () => {
  const post = vi.fn(async (_path: string, body: { candidate_id: string }) => {
    if (body.candidate_id === 'candidate-b') {throw new Error('资料存在冲突')}
    return { done: true }
  })
  const { runtime } = makeRuntime({ candidates: [base, { ...base, candidate_id: 'candidate-b' }], role: 'tenant_admin', permissions: ['kb.candidate.review', 'kb.candidate.publish'], principal_id: 'author', has_more: false }, post)
  render(<KnowledgePage runtime={runtime} />)
  fireEvent.click(await screen.findByRole('button', { name: '选择本页待处理' }))
  fireEvent.click(screen.getByRole('button', { name: '审核并发布所选（2）' }))
  await screen.findByText(/已发布 1\/2 条/)
  expect(post.mock.calls.map(call => call[0])).toEqual([
    '/api/knowledge-review', '/api/knowledge-publish',
    '/api/knowledge-review', '/api/knowledge-review', '/api/knowledge-review'
  ])
  expect(screen.getByRole('button', { name: '审核并发布所选（1）' })).toBeTruthy()
})

it('keeps an over-limit staged workbook intact and explains how to recover before submission', async () => {
  const post = vi.fn(async () => ({}))
  const upload = vi.fn(async () => ({
    upload_id: 'upload-large',
    filename: '客服问答.xlsx',
    review_submission_limit: 1_000,
    total: 1_001,
    chunks: [{ text: '工作表：FAQ\n问题：示例\n答案：示例答案' }]
  }))
  const { runtime } = makeRuntime(
    { candidates: [], permissions: ['kb.upload', 'kb.author'], principal_id: 'author', has_more: false },
    post,
    upload
  )
  const file = new File(['placeholder'], '客服问答.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(1) })

  render(<KnowledgePage runtime={runtime} />)
  await screen.findByRole('button', { name: '上传并预览' })
  fireEvent.change(screen.getByPlaceholderText('例如：员工手册'), { target: { value: '客服问答' } })
  fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: '上传并预览' }))
  await screen.findByText('本次已解析 1001 条知识；单次最多可提交 1000 条。')
  fireEvent.click(screen.getByRole('button', { name: '提交审核' }))

  expect(post).not.toHaveBeenCalled()
  expect(await screen.findByText('本次已解析 1001 条知识，单次最多可提交 1000 条。请拆分文件后重新上传；当前预览会保留。')).toBeTruthy()
  expect(screen.getByRole('button', { name: '提交审核' })).toBeTruthy()
})

it('batch removes selected live knowledge from enterprise answers after one confirmation', async () => {
  const post = vi.fn(async () => ({ status: 'withdrawn', retrievable: false }))
  const { runtime } = makeRuntime({
    candidates: [{ ...base, status: 'published', kb_state: 'active', retrievable: true }],
    role: 'tenant_admin', permissions: ['kb.delete'], principal_id: 'publisher', has_more: false
  }, post)
  render(<KnowledgePage runtime={runtime} />)
  fireEvent.click(await screen.findByLabelText('选择 员工手册 candidate-a'))
  fireEvent.click(screen.getByRole('button', { name: '批量删除（1）' }))
  expect(screen.getByRole('alert').textContent).toContain('确认永久删除所选 1 条知识')
  fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }))
  await screen.findByText(/已批量删除 1 条知识/)
  expect(post).toHaveBeenCalledWith('/api/knowledge-discard', { candidate_id: 'candidate-a' })
})

it('never embeds the local order tool in the enterprise knowledge page', async () => {
  const { runtime: supervisor } = makeRuntime({
    candidates: [], role: 'supervisor', permissions: ['order.filter'], principal_id: 'supervisor', has_more: false
  })
  render(<KnowledgePage runtime={supervisor} />)
  await screen.findByText(/此列表暂无资料/)
  expect(screen.queryByText('未外呼订单筛选')).toBeNull()
})


it('enables batch deletion for selected pending knowledge as well as published knowledge', async () => {
  const post = vi.fn(async () => ({ status: 'rejected', retrievable: false }))
  const { runtime } = makeRuntime({
    candidates: [base], role: 'tenant_admin', permissions: ['kb.delete'], principal_id: 'publisher', has_more: false
  }, post)
  render(<KnowledgePage runtime={runtime} />)
  fireEvent.click(await screen.findByLabelText('选择 员工手册 candidate-a'))
  expect((screen.getByRole('button', { name: '批量删除（1）' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '批量删除（1）' }))
  fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }))
  await waitFor(() => expect(post).toHaveBeenCalledWith('/api/knowledge-discard', { candidate_id: 'candidate-a' }))
})

it('continues deleting later selected knowledge when one discard fails', async () => {
  const post = vi.fn(async (_path: string, body: { candidate_id: string }) => {
    if (body.candidate_id === 'candidate-a') {throw new Error('temporary failure')}
    return { status: 'rejected', retrievable: false }
  })
  const { runtime } = makeRuntime({
    candidates: [base, { ...base, candidate_id: 'candidate-b', topic: '考勤规则' }],
    role: 'tenant_admin', permissions: ['kb.delete'], principal_id: 'publisher', has_more: false
  }, post)
  render(<KnowledgePage runtime={runtime} />)
  fireEvent.click(await screen.findByRole('button', { name: '选择本页知识' }))
  fireEvent.click(screen.getByRole('button', { name: '批量删除（2）' }))
  fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }))
  await screen.findByText(/已删除 1\/2 条/)
  expect(post.mock.calls.map(call => call[1].candidate_id)).toEqual(['candidate-a', 'candidate-a', 'candidate-a', 'candidate-b'])
  expect(screen.getByRole('button', { name: '批量删除（1）' })).toBeTruthy()
})
