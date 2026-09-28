import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { submitComposerOnEnter } from './composer-keyboard'

it('submits Enter exactly once while preserving IME confirmation and Shift+Enter', () => {
  const submit = vi.fn()
  render(<form onSubmit={event => {event.preventDefault(); submit()}}><textarea aria-label="question" onKeyDown={submitComposerOnEnter} /></form>)
  const input = screen.getByLabelText('question')
  fireEvent.keyDown(input, {key:'Enter',shiftKey:true})
  fireEvent.keyDown(input, {key:'Enter',isComposing:true})
  fireEvent.keyDown(input, {key:'Enter',keyCode:229})
  fireEvent.keyDown(input, {key:'Enter',repeat:true})
  expect(submit).not.toHaveBeenCalled()
  fireEvent.keyDown(input, {key:'Enter'})
  expect(submit).toHaveBeenCalledTimes(1)
})
