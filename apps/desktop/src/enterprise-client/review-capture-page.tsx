import { useDoudianEntryCopy } from './doudian-entry-copy'
import { DoudianEntryStatus, type DoudianPageProps } from './doudian-entry-state'
import { DoudianWorkbench } from './doudian-workbench'

export function ReviewCapturePage({ runtime }: DoudianPageProps) {
  const copy = useDoudianEntryCopy()
  return (
    <section className="hesc-page space-y-4" data-testid="review-capture-page">
      <header className="hesc-page-header">
        <h1>{copy.review}</h1>
      </header>
      {runtime ? <DoudianWorkbench runtime={runtime} standalone /> : <DoudianEntryStatus reason={copy.noBridge} state="host-missing" />}
    </section>
  )
}
