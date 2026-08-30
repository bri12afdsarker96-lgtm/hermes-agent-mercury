/**
 * Handoff page — Glue layer.
 *
 * Composes:
 *   - controller (queries + mutations)
 *   - view-model (pure derivations)
 *   - view (presentational; action slots)
 *
 * Per W1-C §P23, the glue owns:
 *   - local form state (reply text)
 *   - FormAction / ConfirmAction composition
 *   - ReactNode composition
 *
 * Per W1-C §P18 (Handoff contract):
 *   - claim: only when handoff.agent_id == null
 *   - reply: only when handoff.status === 'claimed'
 *     body {msg_id, text}; text.trim().length > 0
 *   - requeue: only when handoff.state === 'parked'
 *   - 501 not_implemented → QueryBody renders honest module-
 *     unavailable state (already handled by the existing
 *     QueryBody semantics)
 */

import { Textarea } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { useHandoffsMutations, useKbHandoffs } from './page-handoff.controller'
import { HandoffsView } from './page-handoff.view'
import { deriveHandoffs } from './page-handoff.view-model'

function ReplyActionSlot({ msgId }: { msgId: string }) {
  const mutations = useHandoffsMutations()
  const [text, setText] = useState('')

  return (
    <FormAction
      canSubmit={text.trim().length > 0}
      invalidateKey={['enterprise-console', 'handoffs']}
      permission="inbox.reply"
      submit={() => mutations.reply(msgId, text)}
      submitLabel="Send"
      testId={`console-handoff-reply-${msgId}`}
      title="Reply to this handoff"
      trigger="reply"
    >
      <Textarea
        data-testid={`console-handoff-reply-text-${msgId}`}
        onChange={(event) => setText(event.target.value)}
        placeholder="reply text"
        value={text}
      />
    </FormAction>
  )
}

function HandoffRowActionsSlot({ msgId }: { msgId: string }) {
  const mutations = useHandoffsMutations()

  return (
    <>
      <ConfirmAction
        invalidateKey={['enterprise-console', 'handoffs']}
        permission="inbox.claim"
        run={() => mutations.claim(msgId)}
        testId={`console-handoff-claim-${msgId}`}
        title="Claim this handoff?"
      >
        claim
      </ConfirmAction>
      <ReplyActionSlot msgId={msgId} />
      <ConfirmAction
        invalidateKey={['enterprise-console', 'handoffs']}
        permission="inbox.requeue"
        run={() => mutations.requeue(msgId)}
        testId={`console-handoff-requeue-${msgId}`}
        title="Requeue this handoff?"
      >
        requeue
      </ConfirmAction>
    </>
  )
}

export function HandoffPage() {
  const query = useKbHandoffs()
  const handoffsVm = deriveHandoffs(query.data?.handoffs)

  return (
    <HandoffsView
      handoffRowActionsSlot={({ msgId }) => (
        <HandoffRowActionsSlot msgId={msgId} />
      )}
      handoffs={handoffsVm}
      handoffsError={query.error}
      handoffsIsPending={query.isPending}
    />
  )
}