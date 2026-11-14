import { useCallback, useState } from 'react'

import { useDoudianEntryCopy } from './doudian-entry-copy'
import { DoudianEntryStatus, type DoudianPageProps } from './doudian-entry-state'
import { DoudianLicense } from './doudian-license'
import { DoudianWorkbench } from './doudian-workbench'

export function ReviewCapturePage({ runtime }: DoudianPageProps) {
  const copy = useDoudianEntryCopy()
  const [revision, setRevision] = useState(0)
  const onReady = useCallback(() => setRevision(value => value + 1), [])
  return (
    <section className="hesc-page space-y-4" data-testid="review-capture-page">
      <header className="hesc-page-header">
        <h1>{copy.review}</h1>
      </header>
      {runtime ? <><DoudianLicense runtime={runtime} onReady={onReady} /><DoudianWorkbench key={revision} runtime={runtime} standalone /></> : <DoudianEntryStatus reason={copy.noBridge} state="host-missing" />}
    </section>
  )
}
