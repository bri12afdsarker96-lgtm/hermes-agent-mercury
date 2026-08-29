/**
 * Human Handoff page — Glue layer.
 *
 * Owns: nothing UI-state-related (the view owns reply text state).
 * Composes: query + view-model + view.
 *
 * Builds the transport-bound mutation factory once and passes the
 * three bound callbacks to the view. The view never imports transport.
 *
 * Wave 1 / Step 7 of W5-B0 Controller/View Contract Freeze.
 */

import { findPage } from './catalog'
import { QueryBody } from './page-kit'
import { useWhoami } from './session'
import {
  makeHandoffMutations,
  useHandoffsData,
} from './page-handoff.controller'
import { deriveHandoffViewModel } from './page-handoff.view-model'
import { HandoffView } from './page-handoff.view'
import { useTransport } from './transport'

export function HandoffPage() {
  const who = useWhoami()
  const query = useHandoffsData()
  const transport = useTransport()
  const mutations = makeHandoffMutations(transport)
  const page = findPage('handoff')!

  return (
    <QueryBody
      emptyText="no handoffs"
      isEmpty={vm => !vm.isAvailable || vm.rows.length === 0}
      query={query}
    >
      {data => (
        <HandoffView
          vm={deriveHandoffViewModel({ page, whoami: who, data })}
          onClaim={msgId => {
            void mutations.claim({ msg_id: msgId })
          }}
          onReply={(msgId, text) => {
            void mutations.reply({ msg_id: msgId, text })
          }}
          onRequeue={msgId => {
            void mutations.requeue({ msg_id: msgId })
          }}
        />
      )}
    </QueryBody>
  )
}