/**
 * Enterprise Knowledge page — Presentational view.
 *
 * Receives a KnowledgeViewModel + 6 mutation callbacks + 5 form
 * sub-component inputs (per-row state managed by the view since it's
 * local to each row's textarea / input).
 *
 * The CapabilityBadge for the "knowledge RAG is not production-live"
 * notice is derived from vm.capability in the VM (not via the
 * capability helper directly).
 *
 * Wave 1 / Step 15 of W5-B0 contract freeze.
 */

import { useState, type ChangeEvent } from 'react'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, StatusDot, Textarea } from '@hermes/plugin-sdk'

import { ConsoleRows } from './page-kit'
import type { KnowledgeViewModel } from './page-knowledge.view-model'
import { CapabilityBadge, PageStatusBadge } from './status-badge'
import { PageHeader } from './ui'

export interface KnowledgeViewProps {
  vm: KnowledgeViewModel
  onUploadFile: (args: { bytes: ArrayBuffer; contentType: string; filename: string }) => void
  onAuthorGap: (gapId: string, text: string) => void
  onRejectGap: (gapId: string, reason: string) => void
  onPublishUpload: (uploadId: string, collection: string) => void
  onRollbackUpload: (uploadId: string) => void
  onWithdrawSource: (collection: string, source: string, reason: string) => void
  fmtEpoch: (seconds: null | number | undefined) => string
}

function GapReview({
  gapId,
  onAuthor,
  onReject,
}: {
  gapId: string
  onAuthor: KnowledgeViewProps['onAuthorGap']
  onReject: KnowledgeViewProps['onRejectGap']
}) {
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Dialog
        onOpenChange={open => {
          if (!open) {
            setText('')
          }
        }}
        open={text.trim().length > 0 ? undefined : false}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Author an answer</DialogTitle>
          </DialogHeader>
          <Textarea
            data-testid={`kb-author-text-${gapId}`}
            onChange={event => setText(event.target.value)}
            placeholder="answer text"
            value={text}
          />
          <Button
            data-testid={`kb-author-${gapId}`}
            disabled={text.trim().length === 0}
            onClick={() => {
              onAuthor(gapId, text)
              setText('')
            }}
            size="sm"
          >
            Author
          </Button>
        </DialogContent>
      </Dialog>

      <Button
        data-testid={`kb-author-trigger-${gapId}`}
        onClick={() => setText(' ')}
        size="sm"
        variant="ghost"
      >
        author
      </Button>

      <Dialog
        onOpenChange={open => {
          if (!open) {
            setReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this gap</DialogTitle>
          </DialogHeader>
          <Input onChange={event => setReason(event.target.value)} placeholder="reason" value={reason} />
          <Button
            data-testid={`kb-reject-${gapId}`}
            disabled={reason.trim().length < 3}
            onClick={() => {
              onReject(gapId, reason)
              setReason('')
            }}
            size="sm"
          >
            Reject
          </Button>
        </DialogContent>
      </Dialog>

      <Button
        data-testid={`kb-reject-trigger-${gapId}`}
        onClick={() => setReason(' ')}
        size="sm"
        variant="ghost"
      >
        reject
      </Button>
    </div>
  )
}

function PreviewDialog({
  uploadId,
  preview,
  fmtEpoch,
}: {
  uploadId: string
  preview: null | KnowledgeViewModel['preview']
  fmtEpoch: KnowledgeViewProps['fmtEpoch']
}) {
  const [open, setOpen] = useState(false)
  const isOpen = !!preview

  return (
    <>
      <Button data-testid={`kb-preview-${uploadId}`} onClick={() => setOpen(true)} size="sm" variant="ghost">
        preview
      </Button>
      <Dialog onOpenChange={setOpen} open={open || isOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
          </DialogHeader>
          {preview ? (
            <div className="flex flex-col gap-2" data-testid={`kb-preview-body-${uploadId}`}>
              <div className="text-xs text-muted-foreground">
                {preview.total} chunks · {preview.stats.totalTokens} tokens · PII forbidden {preview.stats.piiForbiddenCount}{' '}
                / warning {preview.stats.piiWarningCount}
              </div>
              <div className="flex max-h-64 flex-col gap-1 overflow-auto">
                {preview.chunks.map(chunk => (
                  <div className="rounded border border-border p-1 text-xs" key={chunk.index}>
                    {chunk.text.slice(0, 200)}
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">est cost: ${preview.stats.estCostUsd}</div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">no chunks · {fmtEpoch(null)}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function PublishAction({
  uploadId,
  onPublish,
}: {
  uploadId: string
  onPublish: KnowledgeViewProps['onPublishUpload']
}) {
  const [collection, setCollection] = useState('')

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Dialog
        onOpenChange={open => {
          if (!open) {
            setCollection('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish to a collection</DialogTitle>
          </DialogHeader>
          <Input
            data-testid={`kb-publish-collection-${uploadId}`}
            onChange={event => setCollection(event.target.value)}
            placeholder="collection"
            value={collection}
          />
          <Button
            data-testid={`kb-publish-${uploadId}`}
            disabled={collection.trim().length === 0 || collection.length > 64}
            onClick={() => {
              onPublish(uploadId, collection)
              setCollection('')
            }}
            size="sm"
          >
            Publish
          </Button>
        </DialogContent>
      </Dialog>

      <Button
        data-testid={`kb-publish-trigger-${uploadId}`}
        onClick={() => setCollection(' ')}
        size="sm"
        variant="ghost"
      >
        publish
      </Button>
    </div>
  )
}

function WithdrawAction({
  collection,
  source,
  onWithdraw,
}: {
  collection: string
  source: string
  onWithdraw: KnowledgeViewProps['onWithdrawSource']
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Dialog
        onOpenChange={open => {
          if (!open) {
            setReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw this source</DialogTitle>
          </DialogHeader>
          <Input
            data-testid={`kb-withdraw-reason-${source}`}
            onChange={event => setReason(event.target.value)}
            placeholder="reason (min 3 chars)"
            value={reason}
          />
          <Button
            data-testid={`kb-withdraw-${source}`}
            disabled={reason.trim().length < 3}
            onClick={() => {
              onWithdraw(collection, source, reason)
              setReason('')
            }}
            size="sm"
          >
            Withdraw
          </Button>
        </DialogContent>
      </Dialog>

      <Button
        data-testid={`kb-withdraw-trigger-${source}`}
        onClick={() => setReason(' ')}
        size="sm"
        variant="ghost"
      >
        withdraw
      </Button>
    </div>
  )
}

function UploadPanel({
  onUpload,
}: {
  onUpload: KnowledgeViewProps['onUploadFile']
}) {
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
      onUpload({ bytes, contentType: file.type || 'application/octet-stream', filename: file.name })
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2" data-testid="console-kb-upload">
      <input
        className="text-xs"
        data-testid="console-kb-upload-input"
        disabled={busy}
        onChange={onFile}
        type="file"
      />
      {busy ? <span className="text-xs text-muted-foreground">uploading…</span> : null}
      {error ? (
        <span className="text-xs text-destructive" data-testid="console-kb-upload-error">
          {error}
        </span>
      ) : null}
    </div>
  )
}

function CandidatesSection({
  vm,
  onAuthorGap,
  onRejectGap,
  fmtEpoch,
}: {
  vm: KnowledgeViewModel
  onAuthorGap: KnowledgeViewProps['onAuthorGap']
  onRejectGap: KnowledgeViewProps['onRejectGap']
  fmtEpoch: KnowledgeViewProps['fmtEpoch']
}) {
  return (
    <section data-testid="console-kb-candidates">
      <div className="mb-1 text-xs font-medium text-muted-foreground">candidates / review</div>
      {vm.isGapsEmpty ? (
        <p className="text-xs text-muted-foreground">no knowledge gaps</p>
      ) : (
        <ConsoleRows testId="console-kb-gaps">
          {vm.gaps.map(gap => (
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              key={gap.gapId}
            >
              <div className="min-w-0">
                <div className="truncate">{gap.query}</div>
                <div className="text-xs text-muted-foreground">
                  {gap.signal} · hits {gap.hits} · {fmtEpoch(gap.tsLast)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs">
                  <StatusDot tone={gap.tone} />
                  {gap.status}
                </span>
                {gap.canReview ? <GapReview gapId={gap.gapId} onAuthor={onAuthorGap} onReject={onRejectGap} /> : null}
              </div>
            </li>
          ))}
        </ConsoleRows>
      )}
    </section>
  )
}

function UploadsSection({
  vm,
  onUploadFile,
  onPublishUpload,
  onRollbackUpload,
  fmtEpoch,
}: {
  vm: KnowledgeViewModel
  onUploadFile: KnowledgeViewProps['onUploadFile']
  onPublishUpload: KnowledgeViewProps['onPublishUpload']
  onRollbackUpload: KnowledgeViewProps['onRollbackUpload']
  fmtEpoch: KnowledgeViewProps['fmtEpoch']
}) {
  return (
    <section data-testid="console-kb-uploads-section">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">uploads</span>
        <UploadPanel onUpload={onUploadFile} />
      </div>
      {vm.isUploadsEmpty ? (
        <p className="text-xs text-muted-foreground">no uploads</p>
      ) : (
        <ConsoleRows testId="console-kb-uploads">
          {vm.uploads.map(upload => (
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              data-upload-status={upload.status}
              key={upload.uploadId}
            >
              <div className="min-w-0">
                <div className="truncate">{upload.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {upload.chunksTotal} chunks · {fmtEpoch(upload.updatedTs)}
                  {upload.errorDetail ? ` · ${upload.errorDetail}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="inline-flex items-center gap-1 text-xs">
                  <StatusDot tone={upload.tone} />
                  {upload.status}
                </span>
                {upload.canPublish ? (
                  <>
                    <PreviewDialog fmtEpoch={fmtEpoch} preview={vm.preview} uploadId={upload.uploadId} />
                    <PublishAction onPublish={onPublishUpload} uploadId={upload.uploadId} />
                    <Button
                      data-testid={`kb-rollback-${upload.uploadId}`}
                      onClick={() => onRollbackUpload(upload.uploadId)}
                      size="sm"
                      variant="ghost"
                    >
                      rollback
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ConsoleRows>
      )}
    </section>
  )
}

function SourcesSection({
  vm,
  selectedCollection,
  onSelectCollection,
  onWithdrawSource,
}: {
  vm: KnowledgeViewModel
  selectedCollection: string
  onSelectCollection: (name: string) => void
  onWithdrawSource: KnowledgeViewProps['onWithdrawSource']
}) {
  return (
    <section data-testid="console-kb-sources">
      <div className="mb-1 text-xs font-medium text-muted-foreground">sources</div>
      {vm.isCollectionsEmpty ? (
        <p className="text-xs text-muted-foreground">no collections</p>
      ) : (
        <div className="flex flex-col gap-2">
          <select
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
            data-testid="console-kb-collection-select"
            onChange={event => onSelectCollection(event.target.value)}
            value={selectedCollection}
          >
            <option value="">select a collection…</option>
            {vm.collections.map(collection => (
              <option key={collection.name} value={collection.name}>
                {collection.name}
              </option>
            ))}
          </select>
          {selectedCollection ? (
            vm.isEntriesEmpty ? (
              <p className="text-xs text-muted-foreground">no sources</p>
            ) : (
              <ConsoleRows testId="console-kb-entries">
                {vm.entries.map(entry => (
                  <li
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                    key={entry.source}
                  >
                    <div className="min-w-0">
                      <div className="truncate">{entry.source}</div>
                      <div className="text-xs text-muted-foreground">{entry.chunks} chunks</div>
                    </div>
                    <WithdrawAction
                      collection={selectedCollection}
                      onWithdraw={onWithdrawSource}
                      source={entry.source}
                    />
                  </li>
                ))}
              </ConsoleRows>
            )
          ) : null}
        </div>
      )}
    </section>
  )
}

export function KnowledgeView({
  vm,
  onUploadFile,
  onAuthorGap,
  onRejectGap,
  onPublishUpload,
  onRollbackUpload,
  onWithdrawSource,
  fmtEpoch,
}: KnowledgeViewProps) {
  const [selectedCollection, setSelectedCollection] = useState('')

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

      {vm.capabilityDev && vm.capability ? (
        <div
          className="mb-(--ec-gutter) flex items-center gap-2 rounded-(--ec-panel-radius) border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-3 py-2 text-(--ui-text-secondary)"
          data-testid="console-knowledge-dev"
        >
          <CapabilityBadge status={vm.capability} />
          <span>knowledge RAG is not production-live on this server</span>
        </div>
      ) : null}

      <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-(--ec-gutter)">
          <UploadsSection
            fmtEpoch={fmtEpoch}
            onPublishUpload={onPublishUpload}
            onRollbackUpload={onRollbackUpload}
            onUploadFile={onUploadFile}
            vm={vm}
          />
          <SourcesSection
            onSelectCollection={setSelectedCollection}
            onWithdrawSource={onWithdrawSource}
            selectedCollection={selectedCollection}
            vm={vm}
          />
        </div>
        <CandidatesSection
          fmtEpoch={fmtEpoch}
          onAuthorGap={onAuthorGap}
          onRejectGap={onRejectGap}
          vm={vm}
        />
      </div>
    </div>
  )
}