import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { $enterprisePackageInstallFrozen } from './enterprise-install-readiness'
import { useDeliveryCopy } from './delivery-copy'
import { useDeliveryWork } from './use-delivery-work'
import type { EnterpriseClientRuntime } from './runtime'
import type { ReminderCenterTask } from './reminder-state'
import { EnterpriseClientError } from './runtime-errors'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { FollowupFilterBar, filterFollowups, historyTime, initialFollowupFilters, isFinished, useFollowupCopy, useFollowupStatus } from './followup-filters'

interface Receivable extends ReminderCenterTask {
  receivable_date?: string
  expected_receive_date?: string
}
interface FollowupList {
  available?: boolean
  followups?: Receivable[]
}
export interface ReceivableDraft {
  business_subject: string
  business_team: string
  amount: string
  receivable_date: string
  expected_receive_date: string
}
const emptyDraft = (): ReceivableDraft => ({
  business_subject: '',
  business_team: '',
  amount: '',
  receivable_date: '',
  expected_receive_date: ''
})
export function validReceivable(draft: ReceivableDraft): boolean {
  return Boolean(
    draft.business_subject.trim() &&
    /^\d+(\.\d{1,2})?$/.test(draft.amount) &&
    Number(draft.amount) > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.expected_receive_date)
  )
}

/** The request key is retained with the exact submitted payload after uncertain failure. */
export function ReceivablesPage({
  runtime,
  principalId,
  scope,
  onInspect
}: {
  runtime: EnterpriseClientRuntime
  principalId: string
  scope: string
  onInspect(task: ReminderCenterTask): void
}) {
  const copy = useDeliveryCopy()
  const filtersCopy = useFollowupCopy()
  const activeStatus = useFollowupStatus()
  const [tab, setTab] = useState<'current'|'history'>('current')
  const [filters, setFilters] = useState(initialFollowupFilters)
  const frozen = useStore($enterprisePackageInstallFrozen)
  const [draft, setDraft] = useState(emptyDraft)
  const [rows, setRows] = useState<Receivable[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const alive = useRef(true)
  const serial = useRef(0)
  const submitting = useRef(false)
  const pending = useRef<(ReceivableDraft & { idempotency_key: string }) | null>(null)
  useDeliveryWork(busy || Object.values(draft).some(Boolean))
  const load = useCallback(async () => {
    const request = ++serial.current
    setLoading(true)
    setError('')
    try {
      const result = await runtime.get<FollowupList>('/api/business-followups')
      if (!alive.current || request !== serial.current) {
        return
      }
      if (!Array.isArray(result.followups) && result.available !== false) {
        throw new Error('invalid response')
      }
      setUnavailable(result.available === false)
      // The existing authenticated endpoint enforces owner/team visibility.
      setRows(result.followups ?? [])
    } catch {
      if (alive.current && request === serial.current) {
        setError(copy.failed)
      }
    } finally {
      if (alive.current && request === serial.current) {
        setLoading(false)
      }
    }
  }, [runtime, principalId, copy.failed])
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
      ++serial.current
    }
  }, [load])
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.scope === scope) {
        void load()
      }
    }
    window.addEventListener('hermes:followup-changed', changed)
    return () => window.removeEventListener('hermes:followup-changed', changed)
  }, [load, scope])
  const create = async () => {
    if (submitting.current || frozen || !runtime.post || !validReceivable(draft)) {
      return
    }
    submitting.current = true
    setBusy(true)
    setNotice('')
    setError('')
    pending.current ??= {
      ...draft,
      business_subject: draft.business_subject.trim(),
      business_team: draft.business_team.trim(),
      idempotency_key: crypto.randomUUID()
    }
    try {
      const response = await runtime.post<{ ok?: boolean; followup?: Receivable }>(
        '/api/business-followups',
        pending.current
      )
      if (!alive.current) {
        return
      }
      if (!response.ok || !response.followup?.source_id) {
        throw new Error('not confirmed')
      }
      pending.current = null
      setUncertain(false)
      setDraft(emptyDraft())
      setNotice(copy.created)
      window.dispatchEvent(new CustomEvent('hermes:followup-changed', { detail: { scope } }))
      await load()
    } catch (reason) {
      if (alive.current) {
        const rejected = reason instanceof EnterpriseClientError && [400, 401, 403, 404, 422].includes(reason.status)
        if (rejected) {
          pending.current = null
        }
        setUncertain(!rejected)
        setError(rejected ? copy.failed : copy.retryHint)
      }
    } finally {
      submitting.current = false
      if (alive.current) {
        setBusy(false)
      }
    }
  }
  const reset = () => {
    pending.current = null
    setDraft(emptyDraft())
    setUncertain(false)
    setError('')
    setNotice('')
  }
  const fields: [keyof ReceivableDraft, string, string][] = [
    ['business_subject', copy.subject, 'text'],
    ['business_team', copy.team, 'text'],
    ['amount', copy.amount, 'text'],
    ['receivable_date', copy.receivableDate, 'date'],
    ['expected_receive_date', copy.expectedDate, 'date']
  ]
  const status = (value: string) =>
    (
      ({
        completed: copy.paid,
        cancelled: copy.cancelled,
        closed: copy.closed,
        waiting_update: activeStatus('waiting_update'),
        open: activeStatus('open'),
        pending_confirmation: activeStatus('pending_confirmation'),
        followup_due: activeStatus('followup_due')
      }) as Record<string, string>
    )[value] ?? value
  const visibleRows = filterFollowups(rows.filter(row => isFinished(row) === (tab === 'history')), filters, principalId)
    .sort((a,b) => tab === 'history' ? historyTime(b)-historyTime(a) || a.source_id.localeCompare(b.source_id) : 0)
  return (
    <section className="hesc-page" aria-label={copy.followups}>
      <header className="hesc-page-header">
        <div>
          <h1>{copy.followups}</h1>
          <p>{copy.followupHint}</p>
        </div>
      </header>
      <form
        className="hesc-delivery-form"
        onSubmit={event => {
          event.preventDefault()
          void create()
        }}
      >
        <div className="hesc-delivery-fields">
          {fields.map(([key, label, type]) => (
            <label key={key}>
              {label}
              <Input
                type={type}
                value={draft[key]}
                maxLength={key === 'business_subject' ? 200 : key === 'business_team' ? 128 : 32}
                disabled={busy || frozen || uncertain || unavailable}
                onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <Button type="submit" disabled={busy || frozen || unavailable || !runtime.post || !validReceivable(draft)}>
          {busy ? copy.working : uncertain ? copy.retrySubmit : copy.create}
        </Button>
        {!uncertain ? (
          <Button type="button" variant="outline" disabled={busy || frozen} onClick={reset}>
            {copy.resetDraft}
          </Button>
        ) : (
          <details>
            <summary>{copy.abandon}</summary>
            <p>{copy.abandonHint}</p>
            <Button type="button" variant="outline" disabled={busy || frozen} onClick={reset}>
              {copy.abandon}
            </Button>
          </details>
        )}
      </form>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="hesc-panel-heading">
        <h2>{copy.followups}</h2>
        <Button variant="outline" disabled={loading || busy} onClick={() => void load()}>
          {copy.refresh}
        </Button>
      </div>
      <SegmentedControl value={tab} onChange={value => {setTab(value);setFilters(current => ({...current,status:'all'}))}} options={[{id:'current',label:filtersCopy.current},{id:'history',label:filtersCopy.history}]} />
      <p className="hesc-muted-copy">{filtersCopy.scope}</p>
      <FollowupFilterBar rows={rows} value={filters} onChange={setFilters} statuses={(tab === 'history' ? ['completed','cancelled','closed'] : ['overdue','open','pending_confirmation','followup_due','waiting_update']).map(value => ({value,label:value === 'overdue' ? filtersCopy.overdue : status(value)}))}/>
      {loading ? (
        <p role="status">{copy.loading}</p>
      ) : unavailable ? (
        <p role="status">{copy.unavailable}</p>
      ) : !visibleRows.length && !error ? (
        <p>{copy.empty}</p>
      ) : null}
      <div className="hesc-table-wrap">
        <table className="hesc-table">
          <thead>
            <tr>
              <th>{copy.subject}</th>
              <th>{copy.amount}</th>
              <th>{copy.expectedDate}</th>
              <th>{copy.status}</th>
              <th>{filtersCopy.owner}</th>
              {tab === 'history' ? <th>{filtersCopy.ended}</th> : null}
              <th>{copy.more}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
              <tr key={row.source_id}>
                <td>
                  {row.business_subject}
                  <br />
                  {row.business_team}
                </td>
                <td>
                  {row.amount} {row.currency}
                </td>
                <td>{row.expected_receive_date ?? '—'}</td>
                <td>{status(row.status)}</td>
                <td>{row.owner_name || row.owner_principal_id}</td>
                {tab === 'history' ? <td>{historyTime(row) ? new Date(historyTime(row)).toLocaleString() : '—'}</td> : null}
                <td>
                  <Button size="sm" variant="outline" onClick={() => onInspect(row)}>
                    {copy.inspect}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
