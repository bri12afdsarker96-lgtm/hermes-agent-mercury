/**
 * Knowledge page — Presentational View layer.
 *
 * Receives fully-derived VMs from the controller/glue. NO transport,
 * NO useQueryClient, NO session atom, NO permission authority, NO
 * `./actions` import. FormAction / ConfirmAction are passed in as
 * ReactNode slots from the glue (they own server write orchestration
 * + permission + invalidation).
 *
 * Per W1-B2-REMEDIATION-01:
 *   - PreviewBody uses QueryBody for ALL states (pending / error /
 *     not_implemented / empty / ready). NO `if (preview) { ... }`
 *     bypass — empty state preserved via QueryBody's `isEmpty`.
 *   - The body testid `kb-preview-body-<id>` only exists inside
 *     QueryBody's READY child, not during loading.
 *   - Pre-split visible copy preserved EXACTLY (no added
 *     `est_cost_usd`, no removed `PII forbidden`/`warning`).
 *   - Pre-split className preserved EXACTLY (DEV banner
 *     `px-3 py-2 text-(--ui-text-secondary)`).
 *   - Pre-split section order preserved: [candidates, uploads, sources].
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
// Per-row action slots
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
  capabilityStatus: CapabilityStatus | null
  gaps: KbGapView[]
  gapsIsPending: boolean
  gapsError: unknown
  gapsRowActionsSlot: (props: GapRowActionsSlotProps) => ReactNode
  uploads: UploadRowView[]
  uploadsIsPending: boolean
  uploadsError: unknown
  uploadsPanelSlot: ReactNode
  uploadsRowActionsSlot: (props: UploadRowActionsSlotProps) => ReactNode
  previewSlot: ReactNode
  collections: CollectionsView
  collectionsIsPending: boolean
  collectionsError: unknown
  selectedCollection: string
  onChangeCollection: (next: string) => void
  // entriesSlot is composed by the glue: the view does NOT know
  // about selection-bound hooks or containers. The glue passes
  // either a KnowledgeEntriesContainer (when selectedCollection
  // is set) or null. The glue also composes the entryRowActionsSlot
  // (the withdraw affordance for each entry row) inside the
  // entriesSlot itself.
  entriesSlot: ReactNode
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
  entriesSlot,
}: KnowledgeViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready-dev"
      data-testid="console-page-knowledge"
    >
      {previewSlot}
      <PageHeader
        purpose="Review knowledge gaps, stage sources, preview chunks and publish through authoritative server workflows."
        status={<PageStatusBadge status="ready-dev" />}
        title="Enterprise knowledge"
      />

      {capabilityStatus && capabilityStatus !== 'LIVE' ? (
        <div
          className="mb-(--ec-gutter) flex items-center gap-2 rounded-(--ec-panel-radius) border border-(--ui-stroke-secondary) bg-(--ui-bg-card) px-3 py-2 text-(--ui-text-secondary)"
          data-testid="console-knowledge-dev"
        >
          <CapabilityBadge status={capabilityStatus} />
          <span>knowledge RAG is not production-live on this server</span>
        </div>
      ) : null}

      {/* Parent-exact grid hierarchy (98e74dd9...):
          GRID CHILD 1 (LEFT column) = Uploads + Sources (in this DOM order)
          GRID CHILD 2 (RIGHT column) = Candidates */}
      <div className="grid items-start gap-(--ec-gutter) xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-(--ec-gutter)">
          <UploadsSection
            uploads={uploads}
            uploadsError={uploadsError}
            uploadsIsPending={uploadsIsPending}
            uploadsPanelSlot={uploadsPanelSlot}
            uploadsRowActionsSlot={uploadsRowActionsSlot}
          />
          <SourcesSection
            collections={collections}
            collectionsError={collectionsError}
            collectionsIsPending={collectionsIsPending}
            entriesSlot={entriesSlot}
            onChangeCollection={onChangeCollection}
            selectedCollection={selectedCollection}
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
// Sections
// ---------------------------------------------------------------------------

interface UploadsSectionProps
  extends Pick<
    KnowledgeViewProps,
    | 'uploads'
    | 'uploadsError'
    | 'uploadsIsPending'
    | 'uploadsPanelSlot'
    | 'uploadsRowActionsSlot'
  > {}

function UploadsSection({
  uploads,
  uploadsError,
  uploadsIsPending,
  uploadsPanelSlot,
  uploadsRowActionsSlot,
}: UploadsSectionProps) {
  return (
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
                    {upload.errorDetail ? ` · ${upload.errorDetail}` : ''}
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

interface SourcesSectionProps
  extends Pick<
    KnowledgeViewProps,
    | 'collections'
    | 'collectionsError'
    | 'collectionsIsPending'
    | 'selectedCollection'
    | 'onChangeCollection'
    | 'entriesSlot'
  > {}

function SourcesSection({
  collections,
  collectionsError,
  collectionsIsPending,
  selectedCollection,
  onChangeCollection,
  entriesSlot,
}: SourcesSectionProps) {
  return (
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
          <SourcesList
            collections={collections.names}
            entriesSlot={entriesSlot}
            onChangeCollection={onChangeCollection}
            selectedCollection={selectedCollection}
          />
        )}
      </QueryBody>
    </section>
  )
}

// ---------------------------------------------------------------------------
// SourcesList — owns the collection select AND conditionally mounts
// the entries container (so no `?collection=` request fires before
// a collection is selected). Per W1-B2-REMEDIATION-01 §P2 + §P13 + §P15.
// ---------------------------------------------------------------------------

export interface SourcesListProps {
  collections: string[]
  selectedCollection: string
  onChangeCollection: (next: string) => void
  // The entriesSlot is composed by the glue (e.g.
  // <KnowledgeEntriesContainer key={collection} collection={collection}
  // entryRowActionsSlot={...} />). The view just renders the slot
  // and does NOT depend on the container / controller / hooks.
  entriesSlot: ReactNode
}

export function SourcesList({
  collections,
  selectedCollection,
  onChangeCollection,
  entriesSlot,
}: SourcesListProps) {
  return (
    <div className="flex flex-col gap-2">
      <select
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        data-testid="console-kb-collection-select"
        onChange={(event) => onChangeCollection(event.target.value)}
        value={selectedCollection}
      >
        <option value="">select a collection…</option>
        {collections.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {/* The glue controls whether the entriesSlot is mounted
          (i.e. whether a container is rendered). The view does
          NOT decide this — it just renders whatever the glue
          passes in. When the glue passes null (no selection),
          nothing renders. When the glue passes a container,
          the container's key={collection} forces re-mount on
          selection switch. */}
      {entriesSlot}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EntriesList — presentational. Receives fully-derived VM from the
// container; no transport, no queries.
// ---------------------------------------------------------------------------

export interface EntriesListProps {
  entries: EntryView[]
  entriesIsPending: boolean
  entriesError: unknown
  selectedCollection: string
  entryRowActionsSlot: (props: EntryRowActionsSlotProps) => ReactNode
}

export function EntriesList({
  entries,
  entriesIsPending,
  entriesError,
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
// PreviewBody — uses QueryBody for ALL states. The body testid is
// ONLY inside the READY child, matching pre-split semantics.
// Per W1-B2-REMEDIATION-01 §P4 + §P14.
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
  return (
    <QueryBody
      emptyText="no chunks"
      isEmpty={(data: { chunks: PreviewChunkView[] }) =>
        (data.chunks ?? []).length === 0
      }
      query={{
        data: { chunks: preview?.chunks ?? [] },
        error,
        isPending,
      }}
    >
      {(data: { chunks: PreviewChunkView[] }) =>
        preview ? (
          <div className="flex flex-col gap-2" data-testid={`kb-preview-body-${uploadId}`}>
            <div className="text-xs text-muted-foreground">
              {preview.total} chunks · {preview.stats.totalTokens} tokens · PII forbidden {preview.stats.piiForbiddenCount} / warning {preview.stats.piiWarningCount}
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
        ) : null
      }
    </QueryBody>
  )
}
