/**
 * Handoff page — Glue layer.
 *
 * Per W1-C-REMEDIATION-01 §P5 + §P9 + §P6:
 *   - Reads `query.data?.available ?? false` (server truth; NEVER
 *     fabricates `available: true`).
 *   - Uses HANDOFFS_KEY constant from controller for every
 *     invalidateKey (no literal query-key arrays in glue).
 *   - Per-row action composition is gated on the three VM-derived
 *     flags (canClaim / canReply / canRequeue). Glue does NOT
 *     recompute state, does NOT infer ownership, does NOT use
 *     else-if mutual exclusivity. Each action is independently
 *     composed from its own flag.
 *
 * Per W1-C §P18 (Handoff contract):
 *   - claim: only when handoff.agent_id == null
 *   - reply: only when handoff.status === 'claimed'
 *     body {msg_id, text}; text.trim().length > 0
 *   - requeue: only when handoff.state === 'parked'
 *   - 501 not_implemented → QueryBody renders honest module-
 *     unavailable state.
 */

import { Textarea } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import {
  HANDOFFS_KEY,
  useHandoffsMutations,
  useKbHandoffs,
} from './page-handoff.controller'
import {
  type HandoffRowActionsSlotProps,
  HandoffsView,
} from './page-handoff.view'
import { deriveHandoffs } from './page-handoff.view-model'

function ReplyActionSlot({ msgId }: { msgId: string }) {
  const mutations = useHandoffsMutations()
  const [text, setText] = useState('')

  return (
    <FormAction
      canSubmit={text.trim().length > 0}
      invalidateKey={HANDOFFS_KEY}
      permission="inbox.reply"
      submit={() => mutations.reply(msgId, text)}
      submitLabel="Send"
      testId={`console-handoff-reply-${msgId}`}
      title="Reply to this handoff"
      trigger="reply"
    >
      <label
        className="sr-only"
        htmlFor={`console-handoff-reply-text-${msgId}`}
      >
        Reply text
      </label>
      <Textarea
        data-testid={`console-handoff-reply-text-${msgId}`}
        id={`console-handoff-reply-text-${msgId}`}
        onChange={(event) => setText(event.target.value)}
        placeholder="reply text"
        value={text}
      />
    </FormAction>
  )
}

function HandoffRowActionsSlot({
  msgId,
  canClaim,
  canReply,
  canRequeue,
}: HandoffRowActionsSlotProps) {
  const mutations = useHandoffsMutations()

  // Each action is independently composed from its own eligibility
  // flag. No else-if mutual exclusivity; no client ownership
  // inference. Server row facts are the sole authority.
  return (
    <>
      {canClaim ? (
        <ConfirmAction
          invalidateKey={HANDOFFS_KEY}
          permission="inbox.claim"
          run={() => mutations.claim(msgId)}
          testId={`console-handoff-claim-${msgId}`}
          title="Claim this handoff?"
        >
          claim
        </ConfirmAction>
      ) : null}
      {canReply ? <ReplyActionSlot msgId={msgId} /> : null}
      {canRequeue ? (
        <ConfirmAction
          invalidateKey={HANDOFFS_KEY}
          permission="inbox.requeue"
          run={() => mutations.requeue(msgId)}
          testId={`console-handoff-requeue-${msgId}`}
          title="Requeue this handoff?"
        >
          requeue
        </ConfirmAction>
      ) : null}
    </>
  )
}

export function HandoffPage() {
  const query = useKbHandoffs()
  const available = query.data?.available ?? false
  const handoffsVm = deriveHandoffs(query.data?.handoffs)

  return (
    <HandoffsView
      available={available}
      handoffRowActionsSlot={(props) => <HandoffRowActionsSlot {...props} />}
      handoffs={handoffsVm}
      handoffsError={query.error}
      handoffsIsPending={query.isPending}
    />
  )
}
