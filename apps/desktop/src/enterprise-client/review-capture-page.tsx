import { useEffect, useState } from 'react'

import { useDoudianEntryCopy } from './doudian-entry-copy'
import { type DoudianPageProps } from './doudian-entry-state'
import { OriginalDoudianWindow } from './doudian-original-window'
import { DoudianWorkbench } from './doudian-workbench'

export function ReviewCapturePage({ runtime }: DoudianPageProps) {
  const copy = useDoudianEntryCopy()
  const [native, setNative] = useState(true)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let alive = true
    const service = runtime?.doudian

    if (!service) {
      setAvailable(false)

      return () => {
        alive = false
      }
    }

    service({ action: 'capabilities' })
      .then(reply => {
        if (alive) {setAvailable(!!reply?.ok && reply?.capabilities?.protocol === 1)}
      })
      .catch(() => {
        if (alive) {setAvailable(false)}
      })

    return () => {
      alive = false
    }
  }, [runtime])

  return (
    <section className="hesc-page space-y-4" data-testid="review-capture-page">
      <header className="hesc-page-header">
        <h1>{copy.review}</h1>
      </header>
      {available && (
        <div aria-label="执行方式" className="flex gap-2" role="group">
          <button aria-pressed={native} className="hesc-action" onClick={() => setNative(true)} type="button">
            原生流程
          </button>
          <button aria-pressed={!native} className="hesc-action" onClick={() => setNative(false)} type="button">
            原版窗口
          </button>
        </div>
      )}
      {available && native && runtime ? (
        <DoudianWorkbench runtime={runtime} />
      ) : (
        <OriginalDoudianWindow feature="review" runtime={runtime} />
      )}
    </section>
  )
}
