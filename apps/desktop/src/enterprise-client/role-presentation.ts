/**
 * Product-owned role presentation.
 *
 * The server remains the sole authority for a principal's role and effective
 * permissions. This module translates those facts into Chinese product copy
 * and filters the owned Desktop navigation. It neither grants permissions nor
 * creates a client-side role switcher.
 */

export type EnterpriseWorkspaceId =
  | 'assistant'
  | 'conversations'
  | 'governance'
  | 'handoffs'
  | 'knowledge'
  | 'reminders'
  | 'workbench'

export interface EnterpriseRoleSnapshot {
  effective_permissions?: readonly string[]
  role?: string
}

export interface EnterpriseWorkspaceDefinition {
  description: string
  glyph: string
  id: EnterpriseWorkspaceId
  label: string
  requiredPermissions?: readonly string[]
}

export interface EnterpriseWorkbenchPresentation {
  purpose: string
  title: string
}

const OPERATOR_WORKSPACES: readonly EnterpriseWorkspaceDefinition[] = [
  { description: '查看个人待办与服务状态', glyph: '01', id: 'workbench', label: '工作台' },
  {
    description: '处理本人可执行的任务与提醒',
    glyph: '02',
    id: 'reminders',
    label: '我的任务',
    requiredPermissions: ['biztask.read', 'reminder.read']
  },
  {
    description: '在获授权范围内使用企业知识',
    glyph: '03',
    id: 'knowledge',
    label: '企业知识',
    requiredPermissions: ['kb.author', 'kb.search']
  },
  { description: '使用企业 AI 协作能力', glyph: '04', id: 'assistant', label: 'AI 助理' }
]

const SUPERVISOR_WORKSPACES: readonly EnterpriseWorkspaceDefinition[] = [
  { description: '查看团队工作与服务状态', glyph: '01', id: 'workbench', label: '团队工作台' },
  {
    description: '处理团队任务与提醒',
    glyph: '02',
    id: 'reminders',
    label: '团队任务',
    requiredPermissions: ['biztask.read', 'reminder.read']
  },
  {
    description: '处理经授权的人工协同事项',
    glyph: '03',
    id: 'handoffs',
    label: '人工接管',
    requiredPermissions: ['inbox.list']
  },
  {
    description: '查看企业会话的投递事实',
    glyph: '04',
    id: 'conversations',
    label: '企业会话',
    requiredPermissions: ['conversation.read']
  },
  {
    description: '在获授权范围内审核企业知识',
    glyph: '05',
    id: 'knowledge',
    label: '知识审核',
    requiredPermissions: ['kb.author']
  },
  { description: '使用企业 AI 协作能力', glyph: '06', id: 'assistant', label: 'AI 助理' }
]

const ADMIN_WORKSPACES: readonly EnterpriseWorkspaceDefinition[] = [
  { description: '查看企业运营与服务状态', glyph: '01', id: 'workbench', label: '运营总览' },
  {
    description: '查看企业会话的投递事实',
    glyph: '02',
    id: 'conversations',
    label: '会话中心',
    requiredPermissions: ['conversation.read']
  },
  {
    description: '处理经授权的人工协同事项',
    glyph: '03',
    id: 'handoffs',
    label: '人工接管',
    requiredPermissions: ['inbox.list']
  },
  {
    description: '查看任务、提醒与业务跟进的真实状态',
    glyph: '04',
    id: 'reminders',
    label: '业务运营',
    requiredPermissions: ['biztask.read', 'reminder.read']
  },
  {
    description: '管理获授权的企业知识工作流',
    glyph: '05',
    id: 'knowledge',
    label: '企业知识',
    requiredPermissions: ['kb.author']
  },
  {
    description: '查看员工权限、能力与治理事实',
    glyph: '06',
    id: 'governance',
    label: '员工与权限',
    requiredPermissions: ['principal.crud', 'tenant.profile.read', 'audit.read']
  },
  { description: '使用企业 AI 协作能力', glyph: '07', id: 'assistant', label: 'AI 助理' }
]

const SAFE_WORKSPACES: readonly EnterpriseWorkspaceDefinition[] = [
  { description: '正在确认企业服务与权限范围', glyph: '01', id: 'workbench', label: '工作台' },
  { description: '使用企业 AI 协作能力', glyph: '02', id: 'assistant', label: 'AI 助理' }
]

function hasAnyPermission(
  effectivePermissions: readonly string[] | undefined,
  requiredPermissions: readonly string[] | undefined
): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true
  }

  if (!effectivePermissions) {
    return false
  }

  return effectivePermissions.includes('*') || requiredPermissions.some(permission => effectivePermissions.includes(permission))
}

function candidateWorkspaces(role: string | undefined): readonly EnterpriseWorkspaceDefinition[] {
  if (role === 'operator') {
    return OPERATOR_WORKSPACES
  }

  if (role === 'supervisor') {
    return SUPERVISOR_WORKSPACES
  }

  if (role === 'tenant_admin' || role === 'super_admin') {
    return ADMIN_WORKSPACES
  }

  return SAFE_WORKSPACES
}

export function enterpriseRoleLabel(role: string | undefined): string {
  if (role === 'operator') {
    return '员工'
  }

  if (role === 'supervisor') {
    return '主管'
  }

  if (role === 'tenant_admin') {
    return '企业管理员'
  }

  if (role === 'super_admin') {
    return '平台管理员'
  }

  return '权限正在确认'
}

export function enterpriseWorkbenchPresentation(role: string | undefined): EnterpriseWorkbenchPresentation {
  if (role === 'operator') {
    return { purpose: '聚焦本人待办、提醒和获授权的企业协作事项。', title: '我的工作台' }
  }

  if (role === 'supervisor') {
    return { purpose: '聚焦团队任务、人工接管与获授权的审核事项。', title: '团队工作台' }
  }

  if (role === 'tenant_admin') {
    return { purpose: '聚焦本企业的运营状态、员工权限与能力治理。', title: '运营总览' }
  }

  if (role === 'super_admin') {
    return { purpose: '聚焦平台运行状态；跨租户内容必须由服务端明确授权。', title: '平台运营' }
  }

  return { purpose: '正在确认当前企业身份和可见工作范围。', title: '企业工作台' }
}

export function enterpriseWorkspaces(snapshot: EnterpriseRoleSnapshot | undefined): EnterpriseWorkspaceDefinition[] {
  const candidates = candidateWorkspaces(snapshot?.role)

  return candidates.filter(workspace => hasAnyPermission(snapshot?.effective_permissions, workspace.requiredPermissions))
}
