import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PrincipalProvisioningPanel } from './principal-provisioning-panel'
import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'

function identity(role: string): EnterpriseIdentity {
  return { name: '当前用户', principal_id: 'principal-current', role, tenant_id: 'tenant-a' }
}

describe('PrincipalProvisioningPanel', () => {
  it('lets a supervisor request an operator account without minting a token client-side', async () => {
    const get = vi.fn(async () => ({ requests: [] }))
    const post = vi.fn(async () => ({ request_id: 'request-1', status: 'pending' }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<PrincipalProvisioningPanel identity={identity('supervisor')} runtime={runtime} />)

    expect(await screen.findByText('主管只能提交员工申请；企业管理员批准前不会创建可登录账号。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('员工姓名'), { target: { value: '新员工' } })
    fireEvent.click(screen.getByRole('button', { name: '提交员工申请' }))

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/principal-provisioning', { name: '新员工', role: 'operator' })
    })
    expect(screen.queryByText('请立即通过受控渠道交付此初始令牌')).toBeNull()
  })

  it('lets a tenant admin approve a pending request and clears the one-time token on intent', async () => {
    const get = vi.fn(async () => ({
      requests: [{ request_id: 'request-1', requested_name: '新员工', requested_role: 'operator', status: 'pending' }]
    }))

    const post = vi.fn(async () => ({ request_id: 'request-1', status: 'approved', token: 'initial-token-once' }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<PrincipalProvisioningPanel identity={identity('tenant_admin')} runtime={runtime} />)

    fireEvent.click(await screen.findByRole('button', { name: '批准并创建账号' }))

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/principal-provisioning-approve', { request_id: 'request-1' })
    })
    expect(await screen.findByText('initial-token-once')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '已安全保存，隐藏令牌' }))
    expect(screen.queryByText('initial-token-once')).toBeNull()
  })

  it('lets a tenant admin reject with an allowlisted reason without retaining a credential', async () => {
    const get = vi.fn(async () => ({
      requests: [{ request_id: 'request-1', requested_name: '未入职员工', requested_role: 'operator', status: 'pending' }]
    }))

    const post = vi.fn(async () => ({ request_id: 'request-1', status: 'rejected' }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<PrincipalProvisioningPanel identity={identity('tenant_admin')} runtime={runtime} />)

    fireEvent.change(await screen.findByRole('combobox', { name: '为 未入职员工 选择驳回理由' }), {
      target: { value: 'position_not_approved' }
    })
    fireEvent.click(await screen.findByRole('button', { name: '驳回申请' }))

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/principal-provisioning-reject', {
        request_id: 'request-1',
        reason: 'position_not_approved'
      })
    })
    expect(await screen.findByText('员工申请已因“岗位尚未批准”驳回；系统未创建账号或初始令牌。')).toBeTruthy()
    expect(screen.queryByText('initial-token-once')).toBeNull()
  })

  it('lets a supervisor withdraw its own pending request before approval', async () => {
    const get = vi.fn(async () => ({
      requests: [{ request_id: 'request-1', requested_name: '待调整员工', requested_role: 'operator', status: 'pending' }]
    }))
    const post = vi.fn(async () => ({ request_id: 'request-1', status: 'withdrawn' }))
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<PrincipalProvisioningPanel identity={identity('supervisor')} runtime={runtime} />)

    fireEvent.click(await screen.findByRole('button', { name: '撤回申请' }))

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/principal-provisioning-withdraw', { request_id: 'request-1' })
    })
    expect(await screen.findByText('员工申请已撤回；如仍需开通，请提交新的申请并等待企业管理员批准。')).toBeTruthy()
  })

  it('does not render a provisioning affordance for an operator', () => {
    const runtime: EnterpriseClientRuntime = { disconnect: vi.fn(async () => undefined), get: vi.fn() }

    const { container } = render(<PrincipalProvisioningPanel identity={identity('operator')} runtime={runtime} />)

    expect(container.firstChild).toBeNull()
  })
})
