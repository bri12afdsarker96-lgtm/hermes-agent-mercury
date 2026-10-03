import { describe, expect, it } from 'vitest'
import { compatibleFilters, initialFilters, metricSelection, moneyMetrics, selectedTitle } from '../../desktop/src/enterprise-client/workspace/receivables-data'

describe('receivable metric navigation contract', () => {
  it('removes mutually exclusive statuses without losing team, owner or text query', () => {
    const filters = {...initialFilters, group_id: 'group-A', owner: 'id:seat-A', query: 'business', status: 'closed'}
    expect(compatibleFilters(filters, metricSelection('due_today', 'CNY'))).toEqual({...filters, status: 'all'})
    expect(compatibleFilters(filters, {...metricSelection('all', ''), detail_view: 'history'})).toBe(filters)
    expect(compatibleFilters({...filters, status: 'open'}, {...metricSelection('all', ''), detail_view: 'history'}).status).toBe('all')
    expect(compatibleFilters(filters, metricSelection('unpaid', 'CNY'))).toBe(filters)
  })
  it('every summary amount selects the same bucket and currency without retaining an old day or history filter', () => {
    for (const [bucket, title] of moneyMetrics) {
      const selection = metricSelection(bucket, 'CNY')
      expect(selection).toEqual({ bucket, currency: 'CNY', due_date: '', detail_view: 'all' })
      expect(selectedTitle(selection)).toBe(title)
    }
  })
  it('retains the administrator deletion filter in history but clears it for active amounts', () => {
    const filters = {...initialFilters, status:'admin_deleted', owner:'id:seat-A'}
    expect(compatibleFilters(filters, {...metricSelection('all',''), detail_view:'history'})).toBe(filters)
    expect(compatibleFilters(filters, metricSelection('due_today','CNY'))).toEqual({...filters, status:'all'})
  })
  it('names a single selected day and distinguishes history from amount drilldowns', () => {
    expect(selectedTitle({ ...metricSelection('outstanding', 'USD'), due_date: '2026-10-03' })).toBe(
      '2026-10-03 待收款'
    )
    expect(selectedTitle({ ...metricSelection('all', ''), detail_view: 'history' })).toBe('历史记录')
  })
})
