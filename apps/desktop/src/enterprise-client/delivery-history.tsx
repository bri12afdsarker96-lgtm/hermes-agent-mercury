import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { EnterpriseClientRuntime } from './runtime'
import { useDeliveryCopy } from './delivery-copy'

export function deliveryTime(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '—'
  }
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

/** Read-only projections, loaded only when explicitly expanded. No resend operation. */
export function DeliveryHistory({ runtime, kind }: { runtime: EnterpriseClientRuntime; kind: 'reminders' | 'outbox' }) {
  const copy = useDeliveryCopy()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    setLoading(true)
    setMessage('')
    const field = kind === 'reminders' ? 'occurrences' : 'outbox'
    void runtime
      .get<Record<string, unknown>>(kind === 'reminders' ? '/api/reminder-occurrences' : '/api/delivery-outbox')
      .then(result => {
        if (!active) {
          return
        }
        if (result.available === false) {
          setRows([])
          setMessage(copy.unavailable)
          return
        }
        if (!Array.isArray(result[field])) {
          throw new Error('invalid history')
        }
        setRows(result[field] as Record<string, unknown>[])
      })
      .catch(() => {
        if (active) {
          setMessage(copy.failed)
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [runtime, kind, open, revision, copy.failed, copy.unavailable])
  const columns =
    kind === 'reminders'
      ? [
          ['title', copy.title],
          ['fire_at', copy.time],
          ['state', copy.status]
        ]
      : [
          ['channel', copy.channel],
          ['state', copy.status],
          ['attempts', copy.attempts],
          ['last_error_class', copy.error],
          ['next_retry_at', copy.nextRetry]
        ]
  return (
    <details className="hesc-delivery-history" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{kind === 'reminders' ? copy.history : copy.deliveries}</summary>
      {open ? (
        <>
          <p>{copy.historyHint}</p>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(value => value + 1)}>
            {copy.refresh}
          </Button>
          {loading ? <p role="status">{copy.loading}</p> : null}
          {message ? <p role="alert">{message}</p> : null}
          {!loading && !message && !rows.length ? <p>{copy.empty}</p> : null}
          <div className="hesc-table-wrap">
            <table className="hesc-table">
              <thead>
                <tr>
                  {columns.map(([field, title]) => (
                    <th key={field}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={String(row.occurrence_id ?? row.intent_id ?? index)}>
                    {columns.map(([field]) => (
                      <td key={field}>
                        {field === 'fire_at' || field === 'next_retry_at'
                          ? deliveryTime(row[field])
                          : String(row[field] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </details>
  )
}
