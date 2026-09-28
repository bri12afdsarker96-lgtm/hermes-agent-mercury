/**
 * Product-owned role presentation.
 *
 * The server remains the sole authority for a principal's role and effective
 * permissions. This module translates those facts into Chinese product copy
 * and filters the owned Desktop navigation. It neither grants permissions nor
 * creates a client-side role switcher.
 */

export type EnterpriseWorkspaceId =
  | 'ai_config'
  | 'assistant'
  | 'knowledge_qa'
  | 'customer_replies'
  | 'conversations'
  | 'governance'
  | 'handoffs'
  | 'knowledge'
  | 'platform'
  | 'reminders'
  | 'receivables'
  | 'overdue'
  | 'tools'
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

export interface EnterpriseWorkflowPresentation {
  purpose: string
  title: string
}

const OPERATOR_WORKSPACES: readonly EnterpriseWorkspaceDefinition[] = [
  { description: '查看个人待办与服务状态', glyph: '01', id: 'workbench', label: '工作台' },
  {
    description: '处理本人可执行的任务与提醒',
    glyph: '02',
    id: 'reminders',
    label: '提醒中心',
    requiredPermissions: ['biztask.read', 'reminder.read']
  },
  { description: '使用企业 AI 协作能力', glyph: '04', id: 'assistant', label: 'AI 助理' },
  { description: '在当前设备本地处理业务文件', glyph: '05', id: 'tools', label: '工具集' }
]

const SUPERVISOR_WORKSPACES: readonly EnterpriseWorkspaceDefinition[] = [
  { description: '查看团队工作与服务状态', glyph: '01', id: 'workbench', label: '团队工作台' },
  {
    description: '处理团队任务与提醒',
    glyph: '02',
    id: 'reminders',
    label: '提醒中心',
    requiredPermissions: ['biztask.read', 'reminder.read']
  },
  {
    description: '查看企业会话的投递事实',
    glyph: '04',
    id: 'conversations',
    label: '企业会话',
    requiredPermissions: ['conversation.read']
  },
  { description: '使用企业 AI 协作能力', glyph: '06', id: 'assistant', label: 'AI 助理' },
  { description: '在当前设备本地处理业务文件', glyph: '07', id: 'tools', label: '工具集' }
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
    description: '查看任务、提醒与业务跟进的真实状态',
    glyph: '04',
    id: 'reminders',
    label: '提醒中心',
    requiredPermissions: ['biztask.read', 'reminder.read']
  },
  {
    description: '管理获授权的企业知识工作流',
    glyph: '05',
    id: 'knowledge',
    label: '企业知识',
    requiredPermissions: ['kb.candidate.view']
  },
  {
    description: '配置企业 AI 模型、密钥与人设',
    glyph: '06',
    id: 'ai_config',
    label: 'AI模型配置',
    requiredPermissions: ['tenant.profile.read']
  },
  {
    description: '查看员工权限、能力与治理事实',
    glyph: '07',
    id: 'governance',
    label: '员工与权限',
    requiredPermissions: ['principal.crud', 'tenant.profile.read', 'audit.read']
  },
  { description: '使用企业 AI 协作能力', glyph: '08', id: 'assistant', label: 'AI 助理' },
  { description: '在当前设备本地处理业务文件', glyph: '08', id: 'tools', label: '工具集' }
]

/** Platform authority is deliberately separate from a tenant administrator.
 * A global super_admin has no tenant_id and must never be sent through
 * tenant-scoped conversations, governance, knowledge or workflow endpoints. */
const PLATFORM_WORKSPACES: readonly EnterpriseWorkspaceDefinition[] = [
  {
    description: '开通企业租户并查看平台侧租户状态',
    glyph: '01',
    id: 'platform',
    label: '企业开通',
    requiredPermissions: ['tenant.crud']
  }
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

  return effectivePermissions.includes('*') || requiredPermissions.some(permission => effectivePermissions.some(granted => granted === permission || (granted.endsWith('.*') && permission.startsWith(granted.slice(0, -1)))))
}

function candidateWorkspaces(role: string | undefined): readonly EnterpriseWorkspaceDefinition[] {
  if (role === 'operator') {
    return OPERATOR_WORKSPACES
  }

  if (role === 'supervisor') {
    return SUPERVISOR_WORKSPACES
  }

  if (role === 'tenant_admin') {
    return ADMIN_WORKSPACES
  }

  if (role === 'super_admin') {
    return PLATFORM_WORKSPACES
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

export function enterpriseWorkflowPresentation(role: string | undefined): EnterpriseWorkflowPresentation {
  if (role === 'operator') {
    return { purpose: '处理本人获授权的业务任务、提醒和跟进事项。', title: '我的任务' }
  }

  if (role === 'supervisor') {
    return { purpose: '处理团队范围内获授权的任务、提醒和跟进事项。', title: '团队任务' }
  }

  if (role === 'tenant_admin') {
    return { purpose: '查看本企业获授权的任务、提醒和业务跟进事实。', title: '业务运营' }
  }

  if (role === 'super_admin') {
    return { purpose: '查看平台运营事实；跨租户内容必须由服务端明确授权。', title: '业务运营' }
  }

  return { purpose: '正在确认当前企业身份和可见业务范围。', title: '业务工作' }
}

export function enterpriseWorkspaces(snapshot: EnterpriseRoleSnapshot | undefined): EnterpriseWorkspaceDefinition[] {
  const candidates = candidateWorkspaces(snapshot?.role)

  const entries = [...candidates]
  if (['operator', 'supervisor', 'tenant_admin'].includes(snapshot?.role ?? '')) {
    entries.splice(1, 0,
      { id: 'assistant', label: '企业 AI 助手', glyph: 'AI', description: '直接提问，结合企业知识解答问题' },
      )
    entries.push({ id: 'receivables', label: '应收款跟进', glyph: '款', description: '创建和处理本人应收款', requiredPermissions: ['reminder.read'] })
    entries.push({ id: 'overdue', label: '逾期未处理', glyph: '期', description: '查看权限范围内的逾期待办', requiredPermissions: ['reminder.read'] })
  }
  return entries.filter((workspace, index) => entries.findIndex(item => item.id === workspace.id) === index)
    .filter(workspace => hasAnyPermission(snapshot?.effective_permissions, workspace.requiredPermissions))
}
