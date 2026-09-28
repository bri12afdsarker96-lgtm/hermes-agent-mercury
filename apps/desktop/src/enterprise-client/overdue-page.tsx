import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Button } from '@/components/ui/button'
import { $enterpriseReminderTasks, type ReminderCenterTask } from './reminder-state'
import { FollowupFilterBar, filterFollowups, initialFollowupFilters, isFinished, useFollowupCopy, useFollowupStatus } from './followup-filters'
import { useDeliveryCopy } from './delivery-copy'

export function OverduePage({scope,principalId,onInspect}: {scope:string;principalId:string;onInspect(task:ReminderCenterTask):void}) {
  const copy = useDeliveryCopy()
  const words = useFollowupCopy()
  const status = useFollowupStatus()
  const cache = useStore($enterpriseReminderTasks)
  const rows = cache?.scope === scope ? cache.rows.filter(row => row.overdue && !isFinished(row)) : null
  const [filters,setFilters] = useState(initialFollowupFilters)
  const refresh = useCallback(() => window.dispatchEvent(new CustomEvent('hermes:followup-changed',{detail:{scope}})),[scope])
  useEffect(() => {refresh()},[refresh])
  const visible = filterFollowups(rows ?? [], filters, principalId)
  return <section className="hesc-page" aria-label={words.overdue}>
    <header className="hesc-page-header"><div><h1>{words.overdue}</h1><p>{words.scope}</p></div><Button variant="outline" onClick={refresh}>{copy.refresh}</Button></header>
    <FollowupFilterBar rows={rows ?? []} value={filters} onChange={setFilters} statuses={[...new Set((rows ?? []).map(row => row.status))].map(value => ({value,label:status(value)}))}/>
    {!rows ? <p role="status">{copy.loading}</p> : !visible.length ? <p>{copy.empty}</p> : null}
    <div className="hesc-table-wrap"><table className="hesc-table"><thead><tr><th>{copy.subject}</th><th>{words.owner}</th><th>{copy.expectedDate}</th><th>{copy.status}</th><th>{copy.more}</th></tr></thead><tbody>
      {visible.map(row => <tr key={`${row.source_type}:${row.source_id}`}><td>{row.business_subject}<br/>{row.task_source_label}</td><td>{row.owner_name}</td><td>{row.next_followup_at ? new Date(row.next_followup_at).toLocaleString() : '—'}</td><td>{words.overdue}</td><td><Button size="sm" variant="outline" onClick={() => onInspect(row)}>{copy.inspect}</Button></td></tr>)}
    </tbody></table></div>
  </section>
}
