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
 * Per W1-B2-REMEDIATION-01 §P2 + §P13 + §P14 + §P15:
 *   - selection-bound queries are NOT mounted until the selection
 *     exists. The hook call site is inside child components
 *     (KnowledgeEntriesContainer, KnowledgePreviewContainer) that
 *     are conditionally rendered, so React Hook Rules are preserved
 *     and there is no empty sentinel request.
 *   - The conditional containers receive `key={selection}` so that
 *     switching selection tears down the old React Query
 *     subscription immediately.
 *   - The PreviewDialog mounts the preview container only when
 *     `previewOpen && previewUploadId !== null`.
 *   - The SourcesList mounts the entries container only when
 *     `selectedCollection !== ''`.
 *
 * Per W1-B2-REMEDIATION-01 §P6:
 *   - Upload uses `actionError` (shared with the rest of the console)
 *     for error mapping. No local reimplementation of error codes.
 *
 * Per W1-B2 §P20:
 *   - Publish is direct transport.post → await →
 *     queryClient.invalidateQueries. No client state machine,
 *     no optimistic committed state.
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

import { actionError, ConfirmAction, FormAction } from './actions'
import { capabilityStatus } from './capabilities'
import { fmtEpoch } from './page-kit'
import {
  KB_GAPS_KEY,
  kbEntriesKey,
  UPLOADS_KEY,
  useKbCollections,
  useKbGaps,
  useKbUploads,
  useKnowledgeAuthority,
  useKnowledgeMutations,
} from './page-knowledge.controller'
import { KnowledgePreviewContainer } from './page-knowledge.preview-container'
import { KnowledgeView } from './page-knowledge.view'
import {
  deriveCollections,
  deriveKbGaps,
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
  // Server reads that are ALWAYS live (no selection dependency).
  // These are the only hooks the glue itself calls; the selection-
  // bound hooks live inside child containers.
  // -----------------------------------------------------------------
  const gapsQuery = useKbGaps()
  const uploadsQuery = useKbUploads()
  const collectionsQuery = useKbCollections()

  // -----------------------------------------------------------------
  // Selection identity
  // -----------------------------------------------------------------
  const [selectedCollection, setSelectedCollection] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUploadId, setPreviewUploadId] = useState<null | string>(null)

  // Per-row form state (local; bound to row id)
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

  // Capability truth (server-declared)
  const ragStatus = capabilityStatus(authority.whoamiSnapshot, 'knowledge_rag')

  // VMs (pure derivation)
  const gapsVm = deriveKbGaps(gapsQuery.data?.gaps, fmtEpoch)
  const uploadsVm = deriveUploads(uploadsQuery.data?.uploads, fmtEpoch)
  const collectionsVm = deriveCollections(collectionsQuery.data)

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
      // Per W1-B2-REMEDIATION-01 §P6: use the shared actionError
      // mapper, not a local raw `err.message` fallback.
      setUploadError(actionError(err))
    } finally {
      setUploadBusy(false)
    }
  }

  return (
    <KnowledgeView
      capabilityStatus={ragStatus}
      collections={collectionsVm}
      collectionsError={collectionsQuery.error}
      collectionsIsPending={collectionsQuery.isPending}
      // entries + entriesError + entriesIsPending are now driven by
      // the conditional KnowledgeEntriesContainer (selectedCollection
      // !== ''). The view does not receive them.
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
        previewUploadId ? (
          <PreviewDialog
            onOpenChange={(next) => {
              setPreviewOpen(next)

              if (!next) {
                setPreviewUploadId(null)
              }
            }}
            open={previewOpen}
          >
            {previewOpen ? (
              <KnowledgePreviewContainer key={previewUploadId} uploadId={previewUploadId} />
            ) : null}
          </PreviewDialog>
        ) : null
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
// PreviewDialog — owned by the glue. Mounts the KnowledgePreviewContainer
// only when `previewOpen && previewUploadId !== null`.
// ---------------------------------------------------------------------------

function PreviewDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  children: ReactNode
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Preview</DialogTitle>
        </DialogHeader>
        {open ? children : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// UploadPanel — owned by the glue (not the view; needs transport +
// permission + busy/error local state).
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