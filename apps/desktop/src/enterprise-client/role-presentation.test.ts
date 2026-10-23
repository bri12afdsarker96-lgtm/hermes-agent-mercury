import { describe, expect, it } from 'vitest'

import {
  canConfigureLanghua,
  canConfigureTenantAi,
  enterpriseRoleLabel,
  enterpriseWorkbenchPresentation,
  enterpriseWorkflowPresentation,
  enterpriseWorkspaces
} from './role-presentation'

describe('enterprise role presentation', () => {
  it('separates Langhua connector management from model configuration with explicit tenant/seat scope', () => {
    const admin = {role: 'tenant_admin', tenant_id: 'tenant-a', principal_id: 'admin-a'}
    for (const permission of ['connector.update', 'connector.*', '*']) {
      expect(canConfigureLanghua({...admin, effective_permissions: [permission]})).toBe(true)
    }
    for (const permission of ['tenant.profile.read', 'tenant.*', 'connector.list']) {
      expect(canConfigureLanghua({...admin, effective_permissions: [permission]})).toBe(false)
    }
    for (const role of ['operator', 'supervisor', 'super_admin']) {
      expect(canConfigureLanghua({...admin, role, effective_permissions: ['*']})).toBe(false)
    }
    expect(canConfigureLanghua({...admin, tenant_id: '', effective_permissions: ['*']})).toBe(false)
    expect(canConfigureLanghua({...admin, principal_id: '', effective_permissions: ['*']})).toBe(false)
    expect(canConfigureLanghua(undefined)).toBe(false)
  })
  it('places AI configuration under tools while preserving its tenant administrator permission gate', () => {
    for (const role of ['operator', 'supervisor', 'tenant_admin', 'super_admin']) {
      expect(enterpriseWorkspaces({role, effective_permissions: ['*']}).map(item => item.id)).not.toContain('ai_config')
    }
    expect(canConfigureTenantAi({role:'tenant_admin', effective_permissions:['tenant.profile.read']})).toBe(true)
    expect(canConfigureTenantAi({role:'tenant_admin', effective_permissions:['tenant.*']})).toBe(true)
    expect(canConfigureTenantAi({role:'tenant_admin', effective_permissions:[]})).toBe(false)
    expect(canConfigureTenantAi({role:'operator', effective_permissions:['*']})).toBe(false)
    expect(canConfigureTenantAi({role:'super_admin', effective_permissions:['*']})).toBe(false)
  })
  it('exposes receivables only for tenant roles with reminder read permission', () => {
    for (const role of ['operator', 'supervisor', 'tenant_admin']) {
      expect(enterpriseWorkspaces({role, effective_permissions:['reminder.read']}).map(item => item.id)).toContain('receivables')
      expect(enterpriseWorkspaces({role, effective_permissions:[]}).map(item => item.id)).not.toContain('receivables')
    }
    expect(enterpriseWorkspaces({role:'super_admin',effective_permissions:['*']}).map(item => item.id)).not.toContain('receivables')
  })
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
    ).toEqual(['工作台', '企业 AI 助手', '提醒中心', '工具集'])
  })

  it('does not expose administrator destinations merely because the client sees a role string', () => {
    expect(
      enterpriseWorkspaces({
        effective_permissions: ['conversation.read'],
        role: 'tenant_admin'
      }).map(workspace => workspace.label)
    ).toEqual(['运营总览', '企业 AI 助手', '会话中心', '工具集'])
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
  it('exposes customer reception only with current assist permission while keeping outbound handoffs deferred', () => {
    for (const role of ['operator', 'supervisor', 'tenant_admin']) {
      expect(enterpriseWorkspaces({ role, effective_permissions: ['tenant.ai.assist'] }).map(item => item.id)).toContain('customer_replies')
      expect(enterpriseWorkspaces({ role, effective_permissions: [] }).map(item => item.id)).not.toContain('customer_replies')
      expect(enterpriseWorkspaces({ role, effective_permissions: ['*'] }).map(item => item.id)).not.toContain('handoffs')
    }
  })

  it('shows the browser-local tools entrance to every tenant work role without granting a server capability', () => {
    for (const role of ['operator', 'supervisor', 'tenant_admin']) {
      expect(enterpriseWorkspaces({role, effective_permissions: []}).map(item => item.id)).toContain('tools')
    }
  })

})
