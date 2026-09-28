import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SeatRequestPanel } from './seat-request-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('SeatRequestPanel', () => {
  it('submits a supervisor request without creating a login locally', async () => {
    const get = vi.fn(async () => ({requests: []}))
    const post = vi.fn(async () => ({request: {request_id: 'r-1'}}))
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }
    render(<SeatRequestPanel runtime={runtime} />)
    await screen.findByText('尚未提交坐席申请。')
    fireEvent.change(screen.getByLabelText('员工姓名'), {target: {value: '张三'}})
    fireEvent.change(screen.getByLabelText('登录账号'), {target: {value: 'zhangsan'}})
    fireEvent.click(screen.getByRole('button', {name: '提交坐席申请'}))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/seat-requests', {name: '张三', login_name: 'zhangsan'}))
    expect(screen.queryByText('初始密码')).toBeNull()
  })

  it('never presents a requested seat password in the administrator review view', async () => {
    const get = vi.fn(async () => ({requests: [{request_id: 'r-1', name: '张三', login_name: 'zhangsan', status: 'pending'}]}))
    const post = vi.fn(async () => ({request: {request_id: 'r-1', status: 'approved'}}))
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }
    render(<SeatRequestPanel review runtime={runtime} />)
    await screen.findByText('张三')
    fireEvent.click(screen.getByRole('button', {name: '批准并开通'}))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/seat-requests-decision', {action: 'approve', request_id: 'r-1'}))
    expect(screen.queryByText(/OneTimePass/)).toBeNull()
    expect(screen.queryByRole('button', {name: '查看一次性账号密码'})).toBeNull()
  })

  it('reveals the approved password once in the requesting supervisor queue', async () => {
    const get = vi.fn(async () => ({requests: [{
      request_id: 'r-1', name: '张三', login_name: 'zhangsan', status: 'approved', credentials_ready: true
    }]}))
    const post = vi.fn(async () => ({credentials: {login_name: 'zhangsan', temporary_password: 'OneTimePass'}}))
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }
    render(<SeatRequestPanel runtime={runtime} />)
    await screen.findByRole('button', {name: '查看一次性账号密码'})
    fireEvent.click(screen.getByRole('button', {name: '查看一次性账号密码'}))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/seat-request-credentials', {request_id: 'r-1'}))
    expect(await screen.findByText(/OneTimePass/)).toBeTruthy()
  })
})
