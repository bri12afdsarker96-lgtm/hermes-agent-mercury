/**
 * Enterprise Knowledge page — Glue layer.
 *
 * Owns: preview-dialog open state + preview upload id state. Composes:
 * 4 queries + view-model + view. The preview Dialog's open/close and
 * which upload's preview to show are view-local state, but the view
 * exposes them via the VM's preview field (so the view-model carries
 * the resolved preview payload, not the open boolean).
 *
 * Wave 1 / Step 15 of W5-B0 Controller/View Contract Freeze.
 */

import { useCallback, useState } from 'react'

import { findPage } from './catalog'
import { fmtEpoch } from './page-kit'
import { hasPermission } from './capabilities'
import {
  makeKnowledgeMutations,
  useKbCollections,
  useKbEntries,
  useKbGaps,
  useKbPreview,
  useKbUploads,
} from './page-knowledge.controller'
import { deriveKnowledgeViewModel } from './page-knowledge.view-model'
import { KnowledgeView } from './page-knowledge.view'
import { useWhoami } from './session'
import { useTransport } from './transport'

export function KnowledgePage() {
  const who = useWhoami()
  const page = findPage('knowledge')!

  // Preview dialog state — which upload's preview to load.
  const [previewUploadId, setPreviewUploadId] = useState<null | string>(null)
  const isPreviewOpen = previewUploadId !== null

  const onOpenPreview = useCallback((uploadId: string) => {
    setPreviewUploadId(uploadId)
  }, [])
  const onClosePreview = useCallback(() => {
    setPreviewUploadId(null)
  }, [])

  const transport = useTransport()
  const mutations = makeKnowledgeMutations(transport)

  const canUpload = who === null || hasPermission(who, 'kb.upload')

  const gapsQuery = useKbGaps()
  const uploadsQuery = useKbUploads()
  const collectionsQuery = useKbCollections()
  const entriesQuery = useKbEntries(null) // collection selection lives in the view
  const previewQuery = useKbPreview(previewUploadId)

  return (
    <KnowledgeView
      fmtEpoch={fmtEpoch}
      onAuthorGap={(gapId, text) => {
        void mutations.authorGap({ gap_id: gapId, text })
      }}
      onPublishUpload={(uploadId, collection) => {
        void mutations.publishUpload({ upload_id: uploadId, collection })
      }}
      onRejectGap={(gapId, reason) => {
        void mutations.rejectGap({ gap_id: gapId, reason })
      }}
      onRollbackUpload={uploadId => {
        void mutations.rollbackUpload({ upload_id: uploadId })
      }}
      onUploadFile={canUpload ? args => {
        void mutations.uploadFile(args)
      } : () => {
        /* upload gated by kb.upload — view already hides the panel */
      }}
      onWithdrawSource={(collection, source, reason) => {
        void mutations.withdrawSource({ collection, reason, source })
      }}
      vm={deriveKnowledgeViewModel({
        page,
        whoami: who,
        gaps: gapsQuery.data,
        uploads: uploadsQuery.data,
        collections: collectionsQuery.data,
        entries: entriesQuery.data,
        preview: { data: previewQuery.data, isOpen: isPreviewOpen },
      })}
    />
  )
}