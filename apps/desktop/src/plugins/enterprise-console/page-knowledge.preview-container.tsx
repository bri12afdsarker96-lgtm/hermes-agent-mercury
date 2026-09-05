/**
 * Knowledge page — selection-bound container for preview body.
 *
 * Per W1-B2-REMEDIATION-01 §P2 + §P14:
 *   - This container is mounted ONLY when `previewOpen && previewUploadId`.
 *   - The parent (PreviewDialog) passes `key={uploadId}` so React
 *     tears down the old container (and its React Query subscription)
 *     the moment the user picks a different upload.
 *   - The useKbPreview hook is called only inside this container,
 *     so no initial `?upload_id=` request fires on page mount.
 *   - The container reads the hook result and passes a fully-derived
 *     VM + loading/error state to a presentational PreviewBody.
 *   - NO parent-cached state. NO useEffect → setState relay.
 */

import { useKbPreview } from './page-knowledge.controller'
import { PreviewBody } from './page-knowledge.view'
import { derivePreview } from './page-knowledge.view-model'

export function KnowledgePreviewContainer({
  uploadId,
}: {
  uploadId: string
}) {
  // The hook is mounted only when this component is rendered, which
  // is conditional on a non-empty `uploadId` from the parent.
  const query = useKbPreview(uploadId)
  const preview = derivePreview(query.data)

  return (
    <PreviewBody
      error={query.error}
      isPending={query.isPending}
      preview={preview}
      uploadId={uploadId}
    />
  )
}