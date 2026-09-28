import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDeliveryCopy } from './delivery-copy'
import { deliveryTime } from './delivery-history'
import type { EnterpriseClientRuntime } from './runtime'

export interface HistoricalUpload {
  upload_id: string
  filename: string
  status: string
  created_ts: number
}
export function KnowledgeUploadHistory({
  runtime,
  disabled,
  onResume
}: {
  runtime: EnterpriseClientRuntime
  disabled: boolean
  onResume(row: HistoricalUpload): Promise<void>
}) {
  const copy = useDeliveryCopy()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<HistoricalUpload[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    setLoading(true)
    setError('')
    void runtime
      .get<{ uploads: HistoricalUpload[] }>(`/api/knowledge-uploads?limit=50&offset=${offset}`)
      .then(result => {
        if (!Array.isArray(result.uploads)) {
          throw new Error('invalid upload list')
        }
        if (active) {
          setRows(result.uploads)
        }
      })
      .catch(() => {
        if (active) {
          setError(copy.failed)
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
  }, [runtime, open, offset, revision, copy.failed])
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)} className="hesc-delivery-history">
      <summary>{copy.uploads}</summary>
      {open ? (
        <>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)}>
            {copy.refresh}
          </Button>
          {loading ? (
            <p role="status">{copy.loading}</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : !rows.length ? (
            <p>{copy.empty}</p>
          ) : null}
          <div className="hesc-table-wrap">
            <table className="hesc-table">
              <thead>
                <tr>
                  <th>{copy.file}</th>
                  <th>{copy.status}</th>
                  <th>{copy.uploaded}</th>
                  <th>{copy.more}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.upload_id}>
                    <td>{row.filename}</td>
                    <td>{row.status}</td>
                    <td>{deliveryTime(row.created_ts)}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled || !['staged', 'edited'].includes(row.status)}
                        onClick={() => void onResume(row)}
                      >
                        {copy.resume}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hesc-voice-actions">
            <Button
              aria-label={copy.previous}
              size="sm"
              variant="outline"
              disabled={loading || offset === 0}
              onClick={() => setOffset(value => Math.max(0, value - 50))}
            >
              ←
            </Button>
            <span>{rows.length ? `${offset + 1}–${offset + rows.length}` : '0'}</span>
            <Button
              aria-label={copy.next}
              size="sm"
              variant="outline"
              disabled={loading || rows.length < 50}
              onClick={() => setOffset(value => value + 50)}
            >
              →
            </Button>
          </div>
        </>
      ) : null}
    </details>
  )
}

export function RechunkControls({
  disabled,
  onRechunk
}: {
  disabled: boolean
  onRechunk(size: number, overlap: number): Promise<void>
}) {
  const copy = useDeliveryCopy()
  const [size, setSize] = useState(500)
  const [overlap, setOverlap] = useState(80)
  return (
    <details className="hesc-delivery-history">
      <summary>{copy.rechunk}</summary>
      <p>{copy.rechunkHint}</p>
      <div className="hesc-delivery-fields">
        <label>
          {copy.chunkSize}
          <Input
            type="number"
            min={50}
            max={4000}
            value={size}
            disabled={disabled}
            onChange={event => setSize(Number(event.target.value))}
          />
        </label>
        <label>
          {copy.overlap}
          <Input
            type="number"
            min={0}
            max={size - 1}
            value={overlap}
            disabled={disabled}
            onChange={event => setOverlap(Number(event.target.value))}
          />
        </label>
      </div>
      <Button
        variant="outline"
        disabled={
          disabled ||
          !Number.isInteger(size) ||
          !Number.isInteger(overlap) ||
          size < 50 ||
          size > 4000 ||
          overlap < 0 ||
          overlap >= size
        }
        onClick={() => void onRechunk(size, overlap)}
      >
        {copy.rechunk}
      </Button>
    </details>
  )
}
