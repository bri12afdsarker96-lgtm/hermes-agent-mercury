import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { AnswerActions } from './answer-actions'
import { useDeliveryCopy } from './delivery-copy'
import type { CustomerReplyOption } from './assistant-response'

interface AssistantReplyCardProps {
  text: string
  kind?: CustomerReplyOption['kind'] | 'answer'
}

/** Primary, follow-up and alternative replies use one visual and copy contract. */
export function AssistantReplyCard({ text, kind = 'answer' }: AssistantReplyCardProps) {
  const copy = useDeliveryCopy()
  const title = {
    answer: copy.suggestedReply,
    current_reply: copy.currentReply,
    follow_up: copy.followupReply,
    alternative_reply: copy.alternativeReply
  }[kind]
  return (
    <section aria-label={title} className="hesc-response-option" data-kind={kind}>
      <div className="hesc-reply-body">
        <strong>{title}</strong>
        <CompactMarkdown className="hesc-reply-text" text={text} />
      </div>
      <AnswerActions text={text} />
    </section>
  )
}
