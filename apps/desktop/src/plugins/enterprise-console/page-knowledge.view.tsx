/**
 * Knowledge page — Presentational View layer.
 *
 * Receives fully-derived VMs from the controller/glue. NO transport,
 * NO useQueryClient, NO session atom, NO permission authority, NO
 * `./actions` import. FormAction / ConfirmAction are passed in as
 * ReactNode slots from the glue (they own server write orchestration
 * + permission + invalidation).
 *
 * Reuses `QueryBody`, `ConsoleRows` via `./page-kit`. The Knowledge
 * view file never imports `./transport`, `./fetch-transport`,
 * `./session`, `./capabilities`, `useConsoleQuery`, `axios`,
 * global `fetch`, `window.hermesDesktop`, or `./actions` (per W1-A
 * ESLint boundary + W1-B2 §P14 extra boundary).
 *
 * Per W1-B2 §P27 NO VISUAL REDESIGN. Pre-split visual structure =
 * post-split visual structure (only JSX movement, no className/CSS/
 * layout changes).
 */

import {
  StatusDot,
} from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { ConsoleRows, QueryBody } from './page-kit'
import type {
  CollectionsView,
  EntryView,
  KbGapView,
  PreviewChunkView,
  PreviewView,
  UploadRowView,
} from './page-knowledge.view-model'
import { CapabilityBadge, PageStatusBadge } from './status-badge'
import type { CapabilityStatus } from './types'
import { PageHeader } from './ui'

// ---------------------------------------------------------------------------
// Per-row action slots (provided by glue; FormAction/ConfirmAction are
// NOT imported here — they live in the glue so the view stays free of
// action framework authority).
// ---------------------------------------------------------------------------

export interface GapRowActionsSlotProps {
  gapId: string
}

export interface UploadRowActionsSlotProps {
  uploadId: string
  canPreview: boolean
  canPublish: boolean
  canRollback: boolean
}

export interface EntryRowActionsSlotProps {
  collection: string
  source: string
}

// ---------------------------------------------------------------------------
// Top-level View
// ---------------------------------------------------------------------------

export interface KnowledgeViewProps {
  // Capability truth (server-declared)
  capabilityStatus: CapabilityStatus | null
  // Gaps
  gaps: KbGapView[]
  gapsIsPending: boolean
  gapsError: unknown
  gapsRowActionsSlot: (props: GapRowActionsSlotProps) => ReactNode
  // Uploads
  uploads: UploadRowView[]
  uploadsIsPending: boolean
  uploadsError: unknown
  uploadsPanelSlot: ReactNode
  uploadsRowActionsSlot: (props: UploadRowActionsSlotProps) => ReactNode
  // Preview is rendered by the glue (which owns the Dialog open
  // state). The view accepts the rendered ReactNode and mounts it
  // inside the page tree so the Dialog overlay still works.
  previewSlot: ReactNode
  // Sources / collections / entries
  collections: CollectionsView
  collectionsIsPending: boolean
  collectionsError: unknown
  selectedCollection: string
  onChangeCollection: (next: string) => void
  entries: EntryView[]
  entriesIsPending: boolean
  entriesError: unknown
  entryRowActionsSlot: (props: EntryRowActionsSlotProps) => ReactNode
}

export function KnowledgeView({
  capabilityStatus,
  gaps,
  gapsIsPending,
  gapsError,
  gapsRowActionsSlot,
  uploads,
  uploadsIsPending,
  uploadsError,
  uploadsPanelSlot,
  uploadsRowActionsSlot,
  previewSlot,
  collections,
  collectionsIsPending,
  collectionsError,
  selectedCollection,
  onChangeCollection,
  entries,
  entriesIsPending,
  entriesError,
  entryRowActionsSlot,
}: KnowledgeViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready-dev"
      data-testid="console-page-knowledge"
    >
      {/* PreviewSlot is the Dialog wrapper + body content rendered by
          the glue. The glue owns the open state + selection identity
          (previewUploadId); the view only mounts the slot so the
          Dialog overlay still has a trigger in the tree. */}
      {previewSlot}
      <PageHeader
        purpose="Review knowledge gaps, stage sources, preview chunks and publish through authoritative server workflows."
        status={<PageStatusBadge status="ready-dev" />}
        title="Enterprise knowledge"
      />

      {capabilityStatus && capabilityStatus !== 'LIVE' ? (
        <div
          className="mb-(--ec-gutter) flex items-center gap-2 rounded-(--ec-panel-radius) border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-(--ec-panel-pad)"
          data-testid="console-knowledge-dev"
        >
          <CapabilityBadge status={capabilityStatus} />
          <span>knowledge RAG is not production-live on this server</span>
        </div>
      ) : null}

      <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-(--ec-gutter)">
          <UploadsSection
            collections={collections}
            collectionsError={collectionsError}
            collectionsIsPending={collectionsIsPending}
            entries={entries}
            entriesError={entriesError}
            entriesIsPending={entriesIsPending}
            entryRowActionsSlot={entryRowActionsSlot}
            onChangeCollection={onChangeCollection}
            selectedCollection={selectedCollection}
            uploads={uploads}
            uploadsError={uploadsError}
            uploadsIsPending={uploadsIsPending}
            uploadsPanelSlot={uploadsPanelSlot}
            uploadsRowActionsSlot={uploadsRowActionsSlot}
          />
        </div>
        <CandidatesSection
          gaps={gaps}
          gapsError={gapsError}
          gapsIsPending={gapsIsPending}
          gapsRowActionsSlot={gapsRowActionsSlot}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sections (internal — receive their data as VMs)
// ---------------------------------------------------------------------------

interface UploadsSectionProps
  extends Pick<
    KnowledgeViewProps,
    | 'uploads'
    | 'uploadsError'
    | 'uploadsIsPending'
    | 'uploadsPanelSlot'
    | 'uploadsRowActionsSlot'
    | 'collections'
    | 'collectionsError'
    | 'collectionsIsPending'
    | 'selectedCollection'
    | 'onChangeCollection'
    | 'entries'
    | 'entriesError'
    | 'entriesIsPending'
    | 'entryRowActionsSlot'
  > {}

function UploadsSection({
  uploads,
  uploadsError,
  uploadsIsPending,
  uploadsPanelSlot,
  uploadsRowActionsSlot,
  collections,
  collectionsError,
  collectionsIsPending,
  selectedCollection,
  onChangeCollection,
  entries,
  entriesError,
  entriesIsPending,
  entryRowActionsSlot,
}: UploadsSectionProps) {
  return (
    <>
      <section data-testid="console-kb-uploads-section">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">uploads</span>
          {uploadsPanelSlot}
        </div>
        <QueryBody
          emptyText="no uploads"
          isEmpty={(data: { uploads: unknown[] }) =>
            (data.uploads ?? []).length === 0
          }
          query={{
            data: { uploads },
            error: uploadsError,
            isPending: uploadsIsPending,
          }}
        >
          {() => (
            <ConsoleRows testId="console-kb-uploads">
              {uploads.map((upload) => (
                <li
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                  data-testid={`kb-upload-row-${upload.uploadId}`}
                  data-upload-status={upload.status}
                  key={upload.uploadId}
                >
                  <div className="min-w-0">
                    <div className="truncate">{upload.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {upload.chunksTotal} chunks · {upload.updatedTsDisplay}
                      {upload.errorDetail
                        ? ` · ${upload.errorDetail}`
                        : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <StatusDot tone={upload.tone} />
                      {upload.status}
                    </span>
                    {uploadsRowActionsSlot({
                      uploadId: upload.uploadId,
                      canPreview: upload.canPreview,
                      canPublish: upload.canPublish,
                      canRollback: upload.canRollback,
                    })}
                  </div>
                </li>
              ))}
            </ConsoleRows>
          )}
        </QueryBody>
      </section>

      <section data-testid="console-kb-sources">
        <div className="mb-1 text-xs font-medium text-muted-foreground">sources</div>
        <QueryBody
          emptyText="no collections"
          isEmpty={(data: { collections: string[] }) =>
            (data.collections ?? []).length === 0
          }
          query={{
            data: { collections: collections.names },
            error: collectionsError,
            isPending: collectionsIsPending,
          }}
        >
          {() => (
            <div className="flex flex-col gap-2">
              <select
                className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
                data-testid="console-kb-collection-select"
                onChange={(event) => onChangeCollection(event.target.value)}
                value={selectedCollection}
              >
                <option value="">select a collection…</option>
                {collections.names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {selectedCollection ? (
                <EntriesList
                  entries={entries}
                  entriesError={entriesError}
                  entriesIsPending={entriesIsPending}
                  entryRowActionsSlot={entryRowActionsSlot}
                  selectedCollection={selectedCollection}
                />
              ) : null}
            </div>
          )}
        </QueryBody>
      </section>
    </>
  )
}

interface CandidatesSectionProps
  extends Pick<
    KnowledgeViewProps,
    'gaps' | 'gapsError' | 'gapsIsPending' | 'gapsRowActionsSlot'
  > {}

function CandidatesSection({
  gaps,
  gapsError,
  gapsIsPending,
  gapsRowActionsSlot,
}: CandidatesSectionProps) {
  return (
    <section data-testid="console-kb-candidates">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        candidates / review
      </div>
      <QueryBody
        emptyText="no knowledge gaps"
        isEmpty={(data: { gaps: KbGapView[] }) =>
          (data.gaps ?? []).length === 0
        }
        query={{
          data: { gaps },
          error: gapsError,
          isPending: gapsIsPending,
        }}
      >
        {() => (
          <ConsoleRows testId="console-kb-gaps">
            {gaps.map((gap) => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                data-gap-status={gap.status}
                data-testid={`kb-gap-row-${gap.gapId}`}
                key={gap.gapId}
              >
                <div className="min-w-0">
                  <div className="truncate">{gap.query}</div>
                  <div className="text-xs text-muted-foreground">
                    {gap.signal} · hits {gap.hits} · {gap.tsLastDisplay}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={gap.tone} />
                    {gap.status}
                  </span>
                  {gap.status === 'new'
                    ? gapsRowActionsSlot({ gapId: gap.gapId })
                    : null}
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </section>
  )
}

interface EntriesListProps
  extends Pick<
    KnowledgeViewProps,
    | 'entries'
    | 'entriesError'
    | 'entriesIsPending'
    | 'selectedCollection'
    | 'entryRowActionsSlot'
  > {}

function EntriesList({
  entries,
  entriesError,
  entriesIsPending,
  selectedCollection,
  entryRowActionsSlot,
}: EntriesListProps) {
  return (
    <QueryBody
      emptyText="no sources"
      isEmpty={(data: { entries: EntryView[] }) =>
        (data.entries ?? []).length === 0
      }
      query={{
        data: { entries },
        error: entriesError,
        isPending: entriesIsPending,
      }}
    >
      {() => (
        <ConsoleRows testId="console-kb-entries">
          {entries.map((entry) => (
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              data-testid={`kb-entry-row-${entry.source}`}
              key={entry.source}
            >
              <div className="min-w-0">
                <div className="truncate">{entry.source}</div>
                <div className="text-xs text-muted-foreground">
                  {entry.chunks} chunks
                </div>
              </div>
              {entryRowActionsSlot({
                collection: selectedCollection,
                source: entry.source,
              })}
            </li>
          ))}
        </ConsoleRows>
      )}
    </QueryBody>
  )
}

// ---------------------------------------------------------------------------
// Preview rendering (no transport; receives derived preview VM + the
// uploadId). The Dialog wrapper is owned by the GLUE because the glue
// owns the selection identity and the dialog open state. The view
// only renders the body content (loading / error / not_implemented /
// empty / ready) via QueryBody.
// ---------------------------------------------------------------------------

export interface PreviewBodyProps {
  uploadId: string
  preview: PreviewView | null
  isPending: boolean
  error: unknown
}

export function PreviewBody({
  uploadId,
  preview,
  isPending,
  error,
}: PreviewBodyProps) {
  if (!preview) {
    return (
      <div className="flex flex-col gap-2" data-testid={`kb-preview-body-${uploadId}`}>
        <QueryBody
          emptyText="no chunks"
          isEmpty={(data: { chunks: PreviewChunkView[] }) =>
            (data.chunks ?? []).length === 0
          }
          query={{
            data: { chunks: [] },
            error,
            isPending,
          }}
        >
          {() => null}
        </QueryBody>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`kb-preview-body-${uploadId}`}>
      <div className="text-xs text-muted-foreground">
        {preview.totalDisplay} · {preview.piiForbiddenDisplay} /{' '}
        {preview.piiWarningDisplay} · {preview.estCostDisplay}
      </div>
      <div className="flex max-h-64 flex-col gap-1 overflow-auto">
        {preview.chunks.map((chunk) => (
          <div
            className="rounded border border-border p-1 text-xs"
            data-testid={`kb-preview-chunk-${chunk.index}`}
            key={chunk.index}
          >
            {chunk.textPreview}
          </div>
        ))}
      </div>
    </div>
  )
}