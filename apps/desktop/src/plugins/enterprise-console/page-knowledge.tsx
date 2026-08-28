/**
 * Enterprise Knowledge — the full Phase-1 control surface, all on real Hermes P1
 * routes (no new knowledge API):
 *   - Candidates / review → /api/kb-gaps + kb-gap-author / kb-gap-reject
 *   - Upload             → /api/knowledge-upload (multipart, field "file")
 *   - Preview            → /api/knowledge-preview (chunks + stats + PII counts)
 *   - Publish            → /api/knowledge-commit (SYNCHRONOUS — the HTTP response
 *                          is the authoritative completion; status "committed")
 *   - Rollback           → /api/knowledge-rollback (staged uploads)
 *   - Sources            → /api/knowledge-committed
 *   - Withdraw           → /api/knowledge-delete (destructive)
 *
 * The server owns all authority; every action posts and refetches the
 * authoritative state — no local optimistic success, no local state machine.
 * knowledge_rag is DEV, shown honestly (Capability Truth).
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  StatusDot,
  type StatusTone,
  Textarea,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { type ChangeEvent, useState } from 'react'

import { actionError, ConfirmAction, FormAction } from './actions'
import { capabilityStatus, hasPermission } from './capabilities'
import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'
import { $whoami } from './session'
import { CapabilityBadge, PageStatusBadge } from './status-badge'
import { useTransport } from './transport'
import { PageHeader } from './ui'

const KB_GAPS_KEY = ['enterprise-console', 'kb-gaps'] as const
const UPLOADS_KEY = ['enterprise-console', 'kb-uploads'] as const
const COLLECTIONS_KEY = ['enterprise-console', 'kb-collections'] as const

interface KbGap {
  gap_id: string
  hits: number
  query: string
  signal: string
  status: string
  ts_last: number
}
interface KbGapsResp {
  gaps: KbGap[]
}

interface UploadRow {
  chunks_committed: number
  chunks_total: number
  collection: null | string
  error_detail: null | string
  filename: string
  size_bytes: number
  status: string
  updated_ts: number
  upload_id: string
}
interface UploadsResp {
  uploads: UploadRow[]
}

interface PreviewResp {
  chunks: { char_count: number; index: number; pii_forbidden: number; pii_warning: number; text: string }[]
  stats: { est_cost_usd: number; pii_forbidden_count: number; pii_warning_count: number; total_tokens: number }
  status: string
  total: number
}

interface CollectionsResp {
  collections: string[]
}
interface EntriesResp {
  entries: { chunks: number; source: string }[]
}

const GAP_TONE: Record<string, StatusTone> = { authored: 'good', new: 'warn', rejected: 'muted' }

const UPLOAD_TONE: Record<string, StatusTone> = {
  commit_failed: 'bad',
  committed: 'good',
  committing: 'warn',
  edited: 'warn',
  rolled_back: 'muted',
  staged: 'good',
  uploading: 'muted'
}

// ── Candidates / review ────────────────────────────────────────────────────

function GapReview({ gapId }: { gapId: string }) {
  const transport = useTransport()
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')

  return (
    <div className="flex shrink-0 items-center gap-1">
      <FormAction
        canSubmit={text.trim().length > 0}
        invalidateKey={KB_GAPS_KEY}
        permission="kb.author"
        submit={() => transport.post('/api/kb-gap-author', { gap_id: gapId, text })}
        submitLabel="Author"
        testId={`kb-author-${gapId}`}
        title="Author an answer"
        trigger="author"
      >
        <Textarea
          data-testid={`kb-author-text-${gapId}`}
          onChange={event => setText(event.target.value)}
          placeholder="answer text"
          value={text}
        />
      </FormAction>
      <FormAction
        canSubmit={reason.trim().length >= 3}
        invalidateKey={KB_GAPS_KEY}
        permission="kb.author"
        submit={() => transport.post('/api/kb-gap-reject', { gap_id: gapId, reason })}
        submitLabel="Reject"
        testId={`kb-reject-${gapId}`}
        title="Reject this gap"
        trigger="reject"
      >
        <Input onChange={event => setReason(event.target.value)} placeholder="reason" value={reason} />
      </FormAction>
    </div>
  )
}

function CandidatesSection() {
  const query = useConsoleQuery<KbGapsResp>(KB_GAPS_KEY, '/api/kb-gaps?status=new')

  return (
    <section data-testid="console-kb-candidates">
      <div className="mb-1 text-xs font-medium text-muted-foreground">candidates / review</div>
      <QueryBody emptyText="no knowledge gaps" isEmpty={data => (data.gaps ?? []).length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-kb-gaps">
            {(data.gaps ?? []).map(gap => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                key={gap.gap_id}
              >
                <div className="min-w-0">
                  <div className="truncate">{gap.query}</div>
                  <div className="text-xs text-muted-foreground">
                    {gap.signal} · hits {gap.hits} · {fmtEpoch(gap.ts_last)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={GAP_TONE[gap.status] ?? 'muted'} />
                    {gap.status}
                  </span>
                  {gap.status === 'new' ? <GapReview gapId={gap.gap_id} /> : null}
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </section>
  )
}

// ── Upload + preview + publish + rollback ──────────────────────────────────

function UploadPanel() {
  const transport = useTransport()
  const queryClient = useQueryClient()
  const who = useValue($whoami)
  const canAuthor = who === null || hasPermission(who, 'kb.upload')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const bytes = await file.arrayBuffer()
      await transport.upload('/api/knowledge-upload', {
        bytes,
        contentType: file.type || 'application/octet-stream',
        filename: file.name
      })
      await queryClient.invalidateQueries({ queryKey: UPLOADS_KEY })
    } catch (err) {
      setError(actionError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!canAuthor) {
    return null
  }

  return (
    <div className="flex items-center gap-2" data-testid="console-kb-upload">
      <input className="text-xs" data-testid="console-kb-upload-input" disabled={busy} onChange={onFile} type="file" />
      {busy ? <span className="text-xs text-muted-foreground">uploading…</span> : null}
      {error ? (
        <span className="text-xs text-destructive" data-testid="console-kb-upload-error">
          {error}
        </span>
      ) : null}
    </div>
  )
}

function PreviewBody({ uploadId }: { uploadId: string }) {
  const query = useConsoleQuery<PreviewResp>(
    ['enterprise-console', 'kb-preview', uploadId],
    `/api/knowledge-preview?upload_id=${encodeURIComponent(uploadId)}`,
    0
  )

  return (
    <QueryBody emptyText="no chunks" isEmpty={data => (data.chunks ?? []).length === 0} query={query}>
      {data => (
        <div className="flex flex-col gap-2" data-testid={`kb-preview-body-${uploadId}`}>
          <div className="text-xs text-muted-foreground">
            {data.total} chunks · {data.stats.total_tokens} tokens · PII forbidden {data.stats.pii_forbidden_count} /
            warning {data.stats.pii_warning_count}
          </div>
          <div className="flex max-h-64 flex-col gap-1 overflow-auto">
            {(data.chunks ?? []).map(chunk => (
              <div className="rounded border border-border p-1 text-xs" key={chunk.index}>
                {chunk.text.slice(0, 200)}
              </div>
            ))}
          </div>
        </div>
      )}
    </QueryBody>
  )
}

function PreviewButton({ uploadId }: { uploadId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button data-testid={`kb-preview-${uploadId}`} onClick={() => setOpen(true)} size="sm" variant="ghost">
        preview
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
          </DialogHeader>
          {open ? <PreviewBody uploadId={uploadId} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function PublishAction({ uploadId }: { uploadId: string }) {
  const transport = useTransport()
  const [collection, setCollection] = useState('')

  return (
    <FormAction
      canSubmit={collection.trim().length > 0 && collection.length <= 64}
      invalidateKey={UPLOADS_KEY}
      permission="kb.commit"
      submit={() => transport.post('/api/knowledge-commit', { collection, upload_id: uploadId })}
      submitLabel="Publish"
      testId={`kb-publish-${uploadId}`}
      title="Publish to a collection"
      trigger="publish"
    >
      <Input
        data-testid={`kb-publish-collection-${uploadId}`}
        onChange={event => setCollection(event.target.value)}
        placeholder="collection"
        value={collection}
      />
    </FormAction>
  )
}

function UploadsSection() {
  const transport = useTransport()
  const query = useConsoleQuery<UploadsResp>(UPLOADS_KEY, '/api/knowledge-uploads')

  return (
    <section data-testid="console-kb-uploads-section">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">uploads</span>
        <UploadPanel />
      </div>
      <QueryBody emptyText="no uploads" isEmpty={data => (data.uploads ?? []).length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-kb-uploads">
            {(data.uploads ?? []).map(upload => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                data-upload-status={upload.status}
                key={upload.upload_id}
              >
                <div className="min-w-0">
                  <div className="truncate">{upload.filename}</div>
                  <div className="text-xs text-muted-foreground">
                    {upload.chunks_total} chunks · {fmtEpoch(upload.updated_ts)}
                    {upload.error_detail ? ` · ${upload.error_detail}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={UPLOAD_TONE[upload.status] ?? 'muted'} />
                    {upload.status}
                  </span>
                  {upload.status === 'staged' || upload.status === 'edited' ? (
                    <>
                      <PreviewButton uploadId={upload.upload_id} />
                      <PublishAction uploadId={upload.upload_id} />
                      <ConfirmAction
                        destructive
                        invalidateKey={UPLOADS_KEY}
                        permission="kb.upload"
                        run={() => transport.post('/api/knowledge-rollback', { upload_id: upload.upload_id })}
                        testId={`kb-rollback-${upload.upload_id}`}
                        title="Roll back this upload?"
                      >
                        rollback
                      </ConfirmAction>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </section>
  )
}

// ── Sources (committed) + withdraw ─────────────────────────────────────────

function WithdrawAction({ collection, source }: { collection: string; source: string }) {
  const transport = useTransport()
  const [reason, setReason] = useState('')

  return (
    <FormAction
      canSubmit={reason.trim().length >= 3}
      invalidateKey={['enterprise-console', 'kb-entries', collection]}
      permission="kb.delete"
      submit={() => transport.post('/api/knowledge-delete', { collection, reason, source })}
      submitLabel="Withdraw"
      testId={`kb-withdraw-${source}`}
      title="Withdraw this source"
      trigger="withdraw"
    >
      <Input
        data-testid={`kb-withdraw-reason-${source}`}
        onChange={event => setReason(event.target.value)}
        placeholder="reason (min 3 chars)"
        value={reason}
      />
    </FormAction>
  )
}

function EntriesList({ collection }: { collection: string }) {
  const query = useConsoleQuery<EntriesResp>(
    ['enterprise-console', 'kb-entries', collection],
    `/api/knowledge-committed?collection=${encodeURIComponent(collection)}`
  )

  return (
    <QueryBody emptyText="no sources" isEmpty={data => (data.entries ?? []).length === 0} query={query}>
      {data => (
        <ConsoleRows testId="console-kb-entries">
          {data.entries.map(entry => (
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              key={entry.source}
            >
              <div className="min-w-0">
                <div className="truncate">{entry.source}</div>
                <div className="text-xs text-muted-foreground">{entry.chunks} chunks</div>
              </div>
              <WithdrawAction collection={collection} source={entry.source} />
            </li>
          ))}
        </ConsoleRows>
      )}
    </QueryBody>
  )
}

function SourcesSection() {
  const [collection, setCollection] = useState('')
  const query = useConsoleQuery<CollectionsResp>(COLLECTIONS_KEY, '/api/knowledge-committed')

  return (
    <section data-testid="console-kb-sources">
      <div className="mb-1 text-xs font-medium text-muted-foreground">sources</div>
      <QueryBody emptyText="no collections" isEmpty={data => (data.collections ?? []).length === 0} query={query}>
        {data => (
          <div className="flex flex-col gap-2">
            <select
              className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
              data-testid="console-kb-collection-select"
              onChange={event => setCollection(event.target.value)}
              value={collection}
            >
              <option value="">select a collection…</option>
              {(data.collections ?? []).map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {collection ? <EntriesList collection={collection} /> : null}
          </div>
        )}
      </QueryBody>
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export function KnowledgePage() {
  const status = capabilityStatus(useValue($whoami), 'knowledge_rag')

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready-dev"
      data-testid="console-page-knowledge"
    >
      <PageHeader
        purpose="Review knowledge gaps, stage sources, preview chunks and publish through authoritative server workflows."
        status={<PageStatusBadge status="ready-dev" />}
        title="Enterprise knowledge"
      />

      {status && status !== 'LIVE' ? (
        <div
          className="mb-(--ec-gutter) flex items-center gap-2 rounded-(--ec-panel-radius) border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-3 py-2 text-(--ui-text-secondary)"
          data-testid="console-knowledge-dev"
        >
          <CapabilityBadge status={status} />
          <span>knowledge RAG is not production-live on this server</span>
        </div>
      ) : null}

      <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-(--ec-gutter)">
          <UploadsSection />
          <SourcesSection />
        </div>
        <CandidatesSection />
      </div>
    </div>
  )
}
