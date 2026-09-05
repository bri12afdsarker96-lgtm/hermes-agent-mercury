import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EnterpriseClientShell, EnterpriseStatusBadge } from './enterprise-design-system'

describe('Enterprise design system foundation', () => {
  it('renders a role-neutral shell and delegates navigation selection to its controller', () => {
    const onSelectWorkspace = vi.fn()

    render(
      <EnterpriseClientShell
        activeWorkspace={{ glyph: '01', id: 'workbench', label: '工作台' }}
        connectionState="ready"
        connectionStatus="企业服务已连接"
        identityName="王琳"
        navigationLabel="企业客户端主导航"
        onSelectWorkspace={onSelectWorkspace}
        productChannel="企业工作台"
        productName="Hermes-企业助手"
        scopeLabel="企业管理员"
        statusbarDetail="安全连接 · 服务端权限"
        statusbarLabel="Hermes-企业助手"
        tenantLabel="tenant-a"
        workspaces={[
          { glyph: '01', id: 'workbench', label: '工作台' },
          { glyph: '02', id: 'knowledge', label: '知识空间' }
        ]}
      >
        <section>服务端事实</section>
      </EnterpriseClientShell>
    )

    expect(screen.getByRole('navigation', { name: '企业客户端主导航' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '工作台' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('服务端事实')).toBeTruthy()
    expect(screen.getByText('企业工作台')).toBeTruthy()
    expect(screen.getAllByText('企业管理员')).toHaveLength(2)
    expect(screen.getByLabelText('全局搜索尚未接入')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '知识空间' }))

    expect(onSelectWorkspace).toHaveBeenCalledWith('knowledge')
  })

  it('keeps status wording supplied by the controller', () => {
    render(<EnterpriseStatusBadge tone="warning">服务端能力暂不可用</EnterpriseStatusBadge>)

    expect(screen.getByText('服务端能力暂不可用').getAttribute('data-tone')).toBe('warning')
  })
})
