import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Button } from '@/components/ui/button'
import { $enterpriseReminderTasks, $reminderSync, type ReminderCenterTask } from './reminder-state'
import { FollowupFilterBar, filterFollowups, initialFollowupFilters, isFinished, useFollowupCopy, useFollowupStatus } from './followup-filters'
import { useDeliveryCopy } from './delivery-copy'
import { useWebPresentation } from './web-presentation'

export function OverduePage({scope,principalId,onInspect}: {scope:string;principalId:string;onInspect(task:ReminderCenterTask):void}) {
  const copy = useDeliveryCopy()
  const web = useWebPresentation()
  const words = useFollowupCopy()
  const status = useFollowupStatus()
  const cache = useStore($enterpriseReminderTasks)
  const sync = useStore($reminderSync)
  const failed = sync?.scope === scope && sync.failed
  const rows = cache?.scope === scope ? cache.rows.filter(row => row.overdue && !isFinished(row)) : null
  const [filters,setFilters] = useState(initialFollowupFilters)
  useEffect(() => {if (web.enabled) setFilters(initialFollowupFilters())}, [scope, principalId, web.enabled])
  const refresh = useCallback(() => window.dispatchEvent(new CustomEvent('hermes:followup-changed',{detail:{scope}})),[scope])
  useEffect(() => {refresh()},[refresh])
  const visible = filterFollowups(rows ?? [], filters, principalId)
  return <section className="hesc-page" aria-label={words.overdue}>
    <header className="hesc-page-header"><div><h1>{words.overdue}</h1><p>{words.scope}</p></div><Button variant="outline" onClick={refresh}>{copy.refresh}</Button></header>
    <FollowupFilterBar scopeOptions={cache?.scope === scope ? cache.scope_options : undefined} rows={rows ?? []} value={filters} onChange={setFilters} statuses={[...new Set((rows ?? []).map(row => row.status))].map(value => ({value,label:status(value)}))}/>
    {failed ? <p role="alert">{copy.failed}{sync.lastSuccess ? ` · ${new Date(sync.lastSuccess).toLocaleString()}` : ''}</p> : null}
    {!rows && !failed ? <p role="status">{copy.loading}</p> : rows && !visible.length && !failed ? <p>{copy.empty}</p> : null}
    <div className="hesc-table-wrap"><table className="hesc-table"><thead><tr><th>{copy.subject}</th><th>{words.owner}</th><th>{copy.expectedDate}</th><th>{copy.status}</th><th>{copy.more}</th></tr></thead><tbody>
      {visible.map(row => <tr key={`${row.source_type}:${row.source_id}`}><td>{row.business_subject}<br/>{row.task_source_label}</td><td>{row.owner_name}</td><td>{row.next_followup_at ? new Date(row.next_followup_at).toLocaleString() : '—'}</td><td>{status(row.status)}<br/>{words.overdue}</td><td><Button size="sm" variant="outline" onClick={() => onInspect(row)}>{copy.inspect}</Button></td></tr>)}
    </tbody></table></div>
  </section>
}
