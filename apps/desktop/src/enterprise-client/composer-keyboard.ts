import type { KeyboardEvent } from 'react'

/** Enter submits; Shift+Enter adds a line; IME confirmation never submits. */
export function submitComposerOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) {return}
  event.preventDefault()
  if (!event.repeat) {event.currentTarget.form?.requestSubmit()}
}
