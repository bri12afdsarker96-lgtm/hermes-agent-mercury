import { describe, expect, it } from 'vitest'

import {
  enterpriseRoleLabel,
  enterpriseWorkbenchPresentation,
  enterpriseWorkflowPresentation,
  enterpriseWorkspaces
} from './role-presentation'

describe('enterprise role presentation', () => {
  it('uses Chinese display labels for every server role', () => {
    expect(enterpriseRoleLabel('operator')).toBe('员工')
    expect(enterpriseRoleLabel('supervisor')).toBe('主管')
    expect(enterpriseRoleLabel('tenant_admin')).toBe('企业管理员')
    expect(enterpriseRoleLabel('super_admin')).toBe('平台管理员')
  })

  it('uses the operator workbench while filtering destinations by effective permissions', () => {
    expect(
      enterpriseWorkspaces({
        effective_permissions: ['biztask.read', 'kb.search'],
        role: 'operator'
      }).map(workspace => workspace.label)
    ).toEqual(['工作台', '我的任务', '企业知识', 'AI 助理'])
  })

  it('does not expose administrator destinations merely because the client sees a role string', () => {
    expect(
      enterpriseWorkspaces({
        effective_permissions: ['conversation.read'],
        role: 'tenant_admin'
      }).map(workspace => workspace.label)
    ).toEqual(['运营总览', '会话中心', 'AI 助理'])
  })

  it('keeps the global platform administrator out of tenant-scoped navigation', () => {
    expect(enterpriseWorkspaces({ effective_permissions: ['*'], role: 'super_admin' }).map(workspace => workspace.id)).toEqual([
      'platform'
    ])
  })

  it('fails closed to the safe Chinese navigation for an unknown role', () => {
    expect(enterpriseRoleLabel('unrecognised')).toBe('权限正在确认')
    expect(enterpriseWorkspaces({ effective_permissions: ['*'], role: 'unrecognised' }).map(workspace => workspace.id)).toEqual([
      'workbench',
      'assistant'
    ])
  })

  it('uses the owned workbench title without fabricating a role switcher', () => {
    expect(enterpriseWorkbenchPresentation('operator').title).toBe('我的工作台')
    expect(enterpriseWorkbenchPresentation('supervisor').title).toBe('团队工作台')
    expect(enterpriseWorkbenchPresentation('tenant_admin').title).toBe('运营总览')
    expect(enterpriseWorkbenchPresentation('unrecognised').title).toBe('企业工作台')
  })

  it('uses the same server role fact for the owned business-operation title', () => {
    expect(enterpriseWorkflowPresentation('operator').title).toBe('我的任务')
    expect(enterpriseWorkflowPresentation('supervisor').title).toBe('团队任务')
    expect(enterpriseWorkflowPresentation('tenant_admin').title).toBe('业务运营')
    expect(enterpriseWorkflowPresentation('unrecognised').title).toBe('业务工作')
  })
})
