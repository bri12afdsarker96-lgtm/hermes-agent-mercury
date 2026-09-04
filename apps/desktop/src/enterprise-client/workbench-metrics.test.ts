import { describe, expect, it } from 'vitest'

import { canReadMetricAggregation, workbenchAggregate } from './workbench-metrics'

describe('workbench metric presentation', () => {
  it('does not infer aggregate access when the server omitted metrics.view', () => {
    const identity = { effective_permissions: ['biztask.read'], role: 'supervisor' }

    expect(canReadMetricAggregation(identity)).toBe(false)
    expect(workbenchAggregate(identity, undefined)).toEqual({
      label: '待处理工作',
      note: '服务端尚未提供按主体的待处理工作聚合。',
      value: '—'
    })
  })

  it('presents a supervisor aggregate only from the server metric payload', () => {
    const aggregate = workbenchAggregate(
      { effective_permissions: ['metrics.view'], role: 'supervisor' },
      { metrics: { m15_biz_tasks: { escalated: 7 } } }
    )

    expect(aggregate).toEqual({
      label: '升级任务 · 24 小时',
      note: '服务端审计聚合；不是当前队列数量。',
      value: 7
    })
  })

  it('uses the existing administrator task and handoff aggregates', () => {
    const aggregate = workbenchAggregate(
      { effective_permissions: ['metrics.view'], role: 'tenant_admin' },
      { metrics: { m15_biz_tasks: { created: 28 }, m16_handoff: { claimed: 4 } } }
    )

    expect(aggregate).toEqual({
      label: '业务任务 · 24 小时',
      note: '已认领人工接管：4',
      value: 28
    })
  })
})
