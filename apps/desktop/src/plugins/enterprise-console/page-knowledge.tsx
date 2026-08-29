/**
 * Knowledge page — Glue layer.
 *
 * Composes:
 *   - controller (queries + mutations + capability / permission)
 *   - view-model (pure derivations + validation helpers)
 *   - view (KnowledgeView; selection-bound ReactNode slots)
 *
 * Per W1-B2 §P9, P10, P11, P14:
 *   - The glue owns per-row local state (gap author text, gap reject
 *     reason, publish collection, withdraw reason). Each piece of
 *     state is bound to a specific row id, NOT a parent-cached
 *     shared state, so selection identity === render identity.
 *   - FormAction / ConfirmAction (./actions) live HERE because they
 *     own permission + invalidation + server write orchestration. The
 *     view file does NOT import them (per §P14).
 *   - The glue owns the source-of-truth for selection state (which
 *     collection, which uploadId's preview is open) and the React Query
 *     transport hook for upload bytes.
 *
 * Per W1-B2 §P18 + §P19: Selection identity invariants
 *   - Preview: the dialog is mounted with `open` prop. The preview
 *     body is only mounted when `open === true && previewUploadId !==
 *     null`. Closing the dialog unmounts the body and tears down the
 *     React Query subscription — no stale preview can render under a
 *     different upload id. The dialog is rendered via the view's
 *     `previewSlot: ReactNode` so the view stays presentational.
 *   - Collection: <EntriesList> is mounted only when
 *     `selectedCollection !== ''`. Switching collections tears down
 *     the old list and its subscription before mounting the new one.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  useQueryClient,
} from '@hermes/plugin-sdk'
import { type ChangeEvent, type ReactNode, useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { capabilityStatus } from './capabilities'
import { fmtEpoch } from './page-kit'
import {
  KB_GAPS_KEY,
  kbEntriesKey,
  UPLOADS_KEY,
} from './page-knowledge.controller'
import {
  useKbCollections,
  useKbEntries,
  useKbGaps,
  useKbPreview,
  useKbUploads,
  useKnowledgeAuthority,
  useKnowledgeMutations,
} from './page-knowledge.controller'
import {
  KnowledgeView,
  PreviewBody,
} from './page-knowledge.view'
import {
  deriveCollections,
  deriveEntries,
  deriveKbGaps,
  derivePreview,
  deriveUploads,
  isAuthorTextValid,
  isPublishCollectionValid,
  isRejectReasonValid,
} from './page-knowledge.view-model'

export function KnowledgePage() {
  const authority = useKnowledgeAuthority()
  const mutations = useKnowledgeMutations()
  const queryClient = useQueryClient()

  // -----------------------------------------------------------------
  // Server reads (queries) — owner: controller
  // -----------------------------------------------------------------
  const gapsQuery = useKbGaps()
  const uploadsQuery = useKbUploads()
  const collectionsQuery = useKbCollections()

  // Per-collection entries are only mounted when a collection is
  // selected (per P19). The hook call site is conditional.
  const [selectedCollection, setSelectedCollection] = useState('')
  const entriesQuery = useKbEntries(selectedCollection)

  // -----------------------------------------------------------------
  // Selection identity (per W1-B1 lessons): preview opens via
  // DIALOG state, and the preview query only mounts when the dialog
  // is open. We use a SEPARATE state to track which upload is
  // currently previewing.
  // -----------------------------------------------------------------
  const [previewUploadId, setPreviewUploadId] = useState<null | string>(
    null
  )

  const [previewOpen, setPreviewOpen] = useState(false)
  // The preview query is mounted ONLY when both previewOpen === true
  // AND previewUploadId !== null. Opening the dialog mounts the query;
  // closing tears it down.
  const previewQuery = useKbPreview(previewUploadId ?? '')

  // -----------------------------------------------------------------
  // Per-row form state (local; bound to row id). Each row keeps its
  // OWN text / reason state, NOT shared across rows — this enforces
  // the W1-B2 §P15 invariant.
  // -----------------------------------------------------------------
  const [gapText, setGapText] = useState<Record<string, string>>({})
  const [gapReason, setGapReason] = useState<Record<string, string>>({})

  const [publishCollection, setPublishCollection] = useState<
    Record<string, string>
  >({})

  const [withdrawReason, setWithdrawReason] = useState<
    Record<string, string>
  >({})

  // Upload-panel local state
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<null | string>(null)

  // -----------------------------------------------------------------
  // Capability truth (server-declared; view-model does NOT derive
  // LIVE from page.status — the view consumes the server-side
  // capabilityStatus()).
  // -----------------------------------------------------------------
  const ragStatus = capabilityStatus(authority.whoamiSnapshot, 'knowledge_rag')

  // -----------------------------------------------------------------
  // VMs (pure derivation)
  // -----------------------------------------------------------------
  const gapsVm = deriveKbGaps(gapsQuery.data?.gaps, fmtEpoch)
  const uploadsVm = deriveUploads(uploadsQuery.data?.uploads, fmtEpoch)
  const collectionsVm = deriveCollections(collectionsQuery.data)
  const entriesVm = deriveEntries(entriesQuery.data)
  const previewVm = derivePreview(previewQuery.data)

  // -----------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------
  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setUploadBusy(true)
    setUploadError(null)

    try {
      const bytes = await file.arrayBuffer()
      await mutations.uploadBytes(
        bytes,
        file.type || 'application/octet-stream',
        file.name
      )
      await queryClient.invalidateQueries({ queryKey: UPLOADS_KEY })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadBusy(false)
    }
  }

  // -----------------------------------------------------------------
  // Preview slot (glue owns the Dialog; view owns the body)
  // -----------------------------------------------------------------
  const previewSlot =
    previewUploadId && previewOpen ? (
      <PreviewBody
        error={previewQuery.error}
        isPending={previewQuery.isPending}
        preview={previewVm}
        uploadId={previewUploadId}
      />
    ) : null

  return (
    <KnowledgeView
      capabilityStatus={ragStatus}
      collections={collectionsVm}
      collectionsError={collectionsQuery.error}
      collectionsIsPending={collectionsQuery.isPending}
      entries={entriesVm}
      entriesError={entriesQuery.error}
      entriesIsPending={entriesQuery.isPending}
      entryRowActionsSlot={({ collection, source }) => {
        if (!source) {
          return null
        }

        const reason = withdrawReason[source] ?? ''

        return (
          <FormAction
            canSubmit={isRejectReasonValid(reason)}
            invalidateKey={kbEntriesKey(collection)}
            permission="kb.delete"
            submit={() => mutations.withdraw(collection, source, reason)}
            submitLabel="Withdraw"
            testId={`kb-withdraw-${source}`}
            title="Withdraw this source"
            trigger="withdraw"
          >
            <Input
              data-testid={`kb-withdraw-reason-${source}`}
              onChange={(event) =>
                setWithdrawReason((prev) => ({
                  ...prev,
                  [source]: event.target.value,
                }))
              }
              placeholder="reason (min 3 chars)"
              value={reason}
            />
          </FormAction>
        )
      }}
      gaps={gapsVm}
      gapsError={gapsQuery.error}
      gapsIsPending={gapsQuery.isPending}
      gapsRowActionsSlot={({ gapId }) => {
        if (!gapId) {
          return null
        }

        const text = gapText[gapId] ?? ''
        const reason = gapReason[gapId] ?? ''

        return (
          <div
            className="flex shrink-0 items-center gap-1"
            data-testid={`kb-gap-actions-${gapId}`}
          >
            <FormAction
              canSubmit={isAuthorTextValid(text)}
              invalidateKey={KB_GAPS_KEY}
              permission="kb.author"
              submit={() => mutations.authorGap(gapId, text)}
              submitLabel="Author"
              testId={`kb-author-${gapId}`}
              title="Author an answer"
              trigger="author"
            >
              <Textarea
                data-testid={`kb-author-text-${gapId}`}
                onChange={(event) =>
                  setGapText((prev) => ({
                    ...prev,
                    [gapId]: event.target.value,
                  }))
                }
                placeholder="answer text"
                value={text}
              />
            </FormAction>
            <FormAction
              canSubmit={isRejectReasonValid(reason)}
              invalidateKey={KB_GAPS_KEY}
              permission="kb.author"
              submit={() => mutations.rejectGap(gapId, reason)}
              submitLabel="Reject"
              testId={`kb-reject-${gapId}`}
              title="Reject this gap"
              trigger="reject"
            >
              <Input
                data-testid={`kb-reject-reason-${gapId}`}
                onChange={(event) =>
                  setGapReason((prev) => ({
                    ...prev,
                    [gapId]: event.target.value,
                  }))
                }
                placeholder="reason"
                value={reason}
              />
            </FormAction>
          </div>
        )
      }}
      onChangeCollection={setSelectedCollection}
      previewSlot={
        // The view expects a ReactNode that contains the Dialog +
        // body content. We render the Dialog wrapper here (in the
        // glue) so the glue owns the dialog open state and the
        // body is selection-bound by `uploadId`.
        <>
          <PreviewDialog
            onOpenChange={(next) => {
              setPreviewOpen(next)

              if (!next) {
                setPreviewUploadId(null)
              }
            }}
            open={previewOpen}
            previewSlot={previewSlot}
          />
        </>
      }
      selectedCollection={selectedCollection}
      uploads={uploadsVm}
      uploadsError={uploadsQuery.error}
      uploadsIsPending={uploadsQuery.isPending}
      uploadsPanelSlot={
        authority.canUpload ? (
          <UploadPanel
            busy={uploadBusy}
            error={uploadError}
            onUpload={onUpload}
          />
        ) : null
      }
      uploadsRowActionsSlot={({
        uploadId,
        canPreview,
        canPublish,
        canRollback,
      }) => {
        if (!canPreview && !canPublish && !canRollback) {
          return null
        }

        const collection = publishCollection[uploadId] ?? ''

        return (
          <>
            {canPreview ? (
              <Button
                data-testid={`kb-preview-${uploadId}`}
                onClick={() => {
                  setPreviewUploadId(uploadId)
                  setPreviewOpen(true)
                }}
                size="sm"
                variant="ghost"
              >
                preview
              </Button>
            ) : null}
            {canPublish ? (
              <FormAction
                canSubmit={isPublishCollectionValid(collection)}
                invalidateKey={UPLOADS_KEY}
                permission="kb.commit"
                submit={() => mutations.publish(collection, uploadId)}
                submitLabel="Publish"
                testId={`kb-publish-${uploadId}`}
                title="Publish to a collection"
                trigger="publish"
              >
                <Input
                  data-testid={`kb-publish-collection-${uploadId}`}
                  onChange={(event) =>
                    setPublishCollection((prev) => ({
                      ...prev,
                      [uploadId]: event.target.value,
                    }))
                  }
                  placeholder="collection"
                  value={collection}
                />
              </FormAction>
            ) : null}
            {canRollback ? (
              <ConfirmAction
                destructive
                invalidateKey={UPLOADS_KEY}
                permission="kb.upload"
                run={() => mutations.rollback(uploadId)}
                testId={`kb-rollback-${uploadId}`}
                title="Roll back this upload?"
              >
                rollback
              </ConfirmAction>
            ) : null}
          </>
        )
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Small sub-components owned by the glue (composing FormAction /
// ConfirmAction which are NOT presentational primitives; the view
// must not import them per W1-B2 §P14).
// ---------------------------------------------------------------------------

function UploadPanel({
  busy,
  error,
  onUpload,
}: {
  busy: boolean
  error: null | string
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="flex items-center gap-2" data-testid="console-kb-upload">
      <input
        className="text-xs"
        data-testid="console-kb-upload-input"
        disabled={busy}
        onChange={onUpload}
        type="file"
      />
      {busy ? (
        <span className="text-xs text-muted-foreground">uploading…</span>
      ) : null}
      {error ? (
        <span
          className="text-xs text-destructive"
          data-testid="console-kb-upload-error"
        >
          {error}
        </span>
      ) : null}
    </div>
  )
}

function PreviewDialog({
  open,
  onOpenChange,
  previewSlot,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  previewSlot: ReactNode
}) {
  // The view file does NOT export the Dialog wrapper because the
  // Dialog owns interactive open state — that's glue responsibility.
  // We render a minimal Dialog here using @hermes/plugin-sdk primitives.
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Preview</DialogTitle>
        </DialogHeader>
        {previewSlot}
      </DialogContent>
    </Dialog>
  )
}