/**
 * WeCom status page (SC5) — Glue layer.
 *
 * Composes the controller query + view-model derivation + view. The
 * glue supplies fmtIso and the icons object as PROPS to the view, so
 * the view stays formatter / icon-agnostic.
 *
 * Wave 1 / Step 11 of W5-B0 Controller/View Contract Freeze.
 */

import { findPage } from './catalog'
import { fmtIso, QueryBody } from './page-kit'
import { useWhoami } from './session'
import { useWeComStatus } from './page-wecom.controller'
import { deriveWeComViewModel } from './page-wecom.view-model'
import { WeComView } from './page-wecom.view'

export function WeComPage() {
  const who = useWhoami()
  const query = useWeComStatus()
  const page = findPage('wecom')!

  return (
    <QueryBody emptyText="—" query={query}>
      {data => (
        <WeComView
          fmtIso={fmtIso}
          vm={deriveWeComViewModel({ page, whoami: who, status: data.wecom })}
        />
      )}
    </QueryBody>
  )
}