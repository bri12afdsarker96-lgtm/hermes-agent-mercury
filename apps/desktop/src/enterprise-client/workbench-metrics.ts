import type { EnterpriseIdentity, EnterpriseMetrics } from './runtime'

export interface WorkbenchAggregatePresentation {
  label: string
  note: string
  value: number | string
}

/**
 * The permission is a server-projected fact. This function only prevents an
 * optional aggregate read when the server has already said it is unavailable;
 * it does not grant an action or replace server-side authorization.
 */
export function canReadMetricAggregation(identity: EnterpriseIdentity): boolean {
  const permissions = identity.effective_permissions

  return Boolean(permissions?.includes('*') || permissions?.includes('metrics.view'))
}

function unavailableAggregate(note: string): WorkbenchAggregatePresentation {
  return { label: '待处理工作', note, value: '—' }
}

/**
 * Maps an existing, tenant-scoped Hermes_AI aggregate into owned workbench
 * wording. Counts are event counts in the selected time window, never a
 * fabricated "currently pending" queue size.
 */
export function workbenchAggregate(
  identity: EnterpriseIdentity | undefined,
  metrics: EnterpriseMetrics | undefined
): WorkbenchAggregatePresentation {
  if (!identity || !canReadMetricAggregation(identity)) {
    return unavailableAggregate('服务端尚未提供按主体的待处理工作聚合。')
  }

  const businessTasks = metrics?.metrics?.m15_biz_tasks
  const handoffs = metrics?.metrics?.m16_handoff

  if (identity.role === 'supervisor') {
    return businessTasks
      ? {
          label: '升级任务 · 24 小时',
          note: '服务端审计聚合；不是当前队列数量。',
          value: businessTasks.escalated ?? '—'
        }
      : unavailableAggregate('服务端未返回团队任务聚合。')
  }

  if (identity.role === 'tenant_admin' || identity.role === 'super_admin') {
    return businessTasks
      ? {
          label: '业务任务 · 24 小时',
          note: handoffs ? `已认领人工接管：${handoffs.claimed ?? 0}` : '服务端审计聚合。',
          value: businessTasks.created ?? '—'
        }
      : unavailableAggregate('服务端未返回业务任务聚合。')
  }

  return unavailableAggregate('服务端尚未提供按主体的待处理工作聚合。')
}
