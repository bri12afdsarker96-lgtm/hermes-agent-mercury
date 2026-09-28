import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { addCustomerReply, createCustomerReplyWorkspace, type CustomerReplyWorkspaceStore } from './customer-reply'
import { CustomerReplyFeedback, retireCustomerReplyFeedback } from './customer-reply-feedback'
import { prepareEnterprisePackageInstall, releaseEnterprisePackageInstall } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'

const { flush } = vi.hoisted(() => ({ flush: vi.fn() }))
vi.mock('./customer-reply-persistence', () => ({ flushCustomerDraftsForRequest: flush }))

describe('explicit customer knowledge feedback', () => {
  const workspaces: CustomerReplyWorkspaceStore[] = []
  const post = vi.fn()
  const runtime = { post, get: vi.fn(), disconnect: vi.fn() } as unknown as EnterpriseClientRuntime

  function workspace() {
    const value = createCustomerReplyWorkspace()
    workspaces.push(value)

    return value
  }

  function fill(question = '已签收包裹如何处理？', correction = '如果已经签收，核实退货流程。') {
    fireEvent.change(screen.getByLabelText('需要补充或纠正的问题'), { target: { value: question } })
    fireEvent.change(screen.getByLabelText('人工纠正建议（登记缺口时可不填）'), { target: { value: correction } })
  }

  beforeEach(() => { vi.clearAllMocks(); flush.mockResolvedValue({ revision: 7 }) })
  afterEach(() => { for (const value of workspaces.splice(0)) { retireCustomerReplyFeedback(value) }; releaseEnterprisePackageInstall() })

  it('retains drafts by customer across navigation and blocks install until resolved', async () => {
    const scope = workspace()
    const first = scope.get().activeId
    addCustomerReply(scope)
    const second = scope.get().activeId
    const view = render(<CustomerReplyFeedback customerId={first} ready runtime={runtime} workspace={scope} />)
    fill()
    view.rerender(<CustomerReplyFeedback customerId={second} ready runtime={runtime} workspace={scope} />)
    expect((screen.getByLabelText('需要补充或纠正的问题') as HTMLTextAreaElement).value).toBe('')
    view.unmount()
    let result!: Awaited<ReturnType<typeof prepareEnterprisePackageInstall>>
    await act(async () => { result = await prepareEnterprisePackageInstall('feedback-preservation') })
    expect(result.ready).toBe(false)
    expect(result.reasons.join('')).toContain('未提交文字')
    render(<CustomerReplyFeedback customerId={first} ready runtime={runtime} workspace={scope} />)
    expect((screen.getByLabelText('需要补充或纠正的问题') as HTMLTextAreaElement).value).toBe('已签收包裹如何处理？')
    expect(post).not.toHaveBeenCalled()
  })

  it('waits for a real save acknowledgement and retries the same bounded submission', async () => {
    const scope = workspace()
    let finish!: (value: { revision: number }) => void
    flush.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    post.mockRejectedValueOnce(new Error('暂时无法提交')).mockResolvedValueOnce({ kind: 'correction', recorded: true, gap_id: 'g', candidate_id: 'c', status: 'needs_review', retrievable: false })
    render(<CustomerReplyFeedback customerId={scope.get().activeId} ready runtime={runtime} workspace={scope} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: '提交纠正建议审核' }))
    expect(post).not.toHaveBeenCalled()
    await act(async () => { finish({ revision: 7 }) })
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '提交纠正建议审核' }))
    await screen.findByText(/纠正建议已提交审核/)
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1])
    expect(Object.keys(post.mock.calls[0][1]).sort()).toEqual(['correction', 'customer_id', 'idempotency_key', 'kind', 'question', 'workspace_revision'])
    expect(post.mock.calls[0][1].workspace_revision).toBe(7)
    expect((screen.getByLabelText('需要补充或纠正的问题') as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps text after an incomplete receipt instead of claiming learning success', async () => {
    const scope = workspace()
    post.mockResolvedValue({ kind: 'correction', recorded: true, gap_id: 'g' })
    render(<CustomerReplyFeedback customerId={scope.get().activeId} ready runtime={runtime} workspace={scope} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: '提交纠正建议审核' }))
    await screen.findByText(/未收到完整的提交确认/)
    expect(screen.queryByText(/纠正建议已提交审核/)).toBeNull()
    expect((screen.getByLabelText('人工纠正建议（登记缺口时可不填）') as HTMLTextAreaElement).value).toContain('如果已经签收')
  })

  it('discards retired-account state and ignores its late submission response', async () => {
    const scope = workspace()
    let finish!: (value: unknown) => void
    post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<CustomerReplyFeedback customerId={scope.get().activeId} ready runtime={runtime} workspace={scope} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: '提交纠正建议审核' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    view.unmount()
    retireCustomerReplyFeedback(scope)
    const fresh = workspace()
    render(<CustomerReplyFeedback customerId={fresh.get().activeId} ready runtime={runtime} workspace={fresh} />)
    await act(async () => { finish({ kind: 'correction', recorded: true, gap_id: 'g', candidate_id: 'c', status: 'needs_review', retrievable: false }) })
    expect(screen.queryByText(/纠正建议已提交审核/)).toBeNull()
    expect((screen.getByLabelText('需要补充或纠正的问题') as HTMLTextAreaElement).value).toBe('')
  })
})
