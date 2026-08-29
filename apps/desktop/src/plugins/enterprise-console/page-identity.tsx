/**
 * Identity & Channel Bindings page (SC2) — Glue layer.
 *
 * Owns nothing UI-specific (the create-binding form's local state
 * lives in the view). Composes: 2 queries + view-model + view.
 *
 * The glue supplies fmtEpoch / fmtIso as callback props to the view,
 * so the view stays formatter-agnostic. A future test could mock
 * these as identity functions.
 *
 * Wave 1 / Step 10 of W5-B0 Controller/View Contract Freeze.
 */

import { findPage } from './catalog'
import { fmtEpoch, fmtIso, QueryBody } from './page-kit'
import { useWhoami } from './session'
import {
  makeChannelBindingMutations,
  useChannelBindingsData,
  usePrincipalsData,
} from './page-identity.controller'
import { deriveIdentityViewModel } from './page-identity.view-model'
import { IdentityView } from './page-identity.view'
import { useTransport } from './transport'

export function IdentityPage() {
  const who = useWhoami()
  const principalsQuery = usePrincipalsData()
  const bindingsQuery = useChannelBindingsData()
  const transport = useTransport()
  const mutations = makeChannelBindingMutations(transport)
  const page = findPage('identity')!

  return (
    <QueryBody
      emptyText="no principals"
      isEmpty={vm => vm.isPrincipalsEmpty && vm.isBindingsEmpty}
      query={principalsQuery}
    >
      {principalsData => (
        <QueryBody
          emptyText="no channel bindings"
          isEmpty={vm => vm.isBindingsEmpty}
          query={bindingsQuery}
        >
          {bindingsData => (
            <IdentityView
              fmtEpoch={fmtEpoch}
              fmtIso={fmtIso}
              vm={deriveIdentityViewModel({
                page,
                whoami: who,
                principals: principalsData.principals,
                bindings: bindingsData.bindings,
              })}
              onCreateBinding={body => {
                void mutations.create(body)
              }}
              onRevokeBinding={bindingId => {
                void mutations.revoke({ binding_id: bindingId })
              }}
            />
          )}
        </QueryBody>
      )}
    </QueryBody>
  )
}