import { act, render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantReminders } from './assistant-reminders'
import type { EnterpriseClientRuntime } from './runtime'
import { REMINDER_REPEAT_MS } from './reminder-repeat'
const sound = vi.hoisted(() => ({play: vi.fn(async () => true), stop: vi.fn()}))
vi.mock('./reminder-sound', () => ({ReminderSound: class {play = sound.play; stop = sound.stop}}))
beforeEach(() => localStorage.clear())
afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks()})

describe('reminder polling and notification integration', () => {
  it('repeats while hidden, deduplicates the inbox copy, and makes no business writes', async () => {
    vi.useFakeTimers()
    const notify = vi.fn(async () => true)
    Object.defineProperty(window, 'hermesDesktop', {configurable:true, value:{notify}})
    const row = {reminder_id:'one',title:'待办',state:'active',scheduled_for:1,generation:1,overdue:true}
    const get = vi.fn(async (path:string) => path.startsWith('/api/reminder-center')
      ? {tasks:[{source_type:'assistant_personal',source_id:'one',overdue:true,allowed_actions:['cancel']}]}
      : {reminders:[row]})
    const post = vi.fn()
    const runtime = {get,post} as unknown as EnterpriseClientRuntime
    render(<AssistantReminders runtime={runtime} scope="seat" open={false} request="" onClose={() => {}} />)
    await act(async () => {})
    expect(notify).toHaveBeenCalledTimes(1)
    await act(async () => {await vi.advanceTimersByTimeAsync(REMINDER_REPEAT_MS - 15_000)})
    expect(notify).toHaveBeenCalledTimes(1)
    await act(async () => {await vi.advanceTimersByTimeAsync(15_000)})
    expect(notify).toHaveBeenCalledTimes(2)
    expect(sound.play).toHaveBeenCalledTimes(2)
    await act(async () => {await vi.advanceTimersByTimeAsync(REMINDER_REPEAT_MS)})
    expect(notify).toHaveBeenCalledTimes(2)
    expect(post).not.toHaveBeenCalled()
  })

  it('does not repeat from stale data during an outage or after completion', async () => {
    vi.useFakeTimers()
    const notify = vi.fn(async () => true)
    Object.defineProperty(window, 'hermesDesktop', {configurable:true, value:{notify}})
    let offline = false
    let state = 'active'
    const get = vi.fn(async (path:string) => {
      if (offline) {throw new Error('offline')}
      return path.startsWith('/api/reminder-center') ? {tasks:[]} : {reminders:[{reminder_id:'one',title:'待办',state,scheduled_for:1,overdue:true}]}
    })
    const runtime = {get,post:vi.fn()} as unknown as EnterpriseClientRuntime
    const view = render(<AssistantReminders runtime={runtime} scope="seat" open={false} request="" onClose={() => {}} />)
    await act(async () => {})
    offline = true
    await act(async () => {await vi.advanceTimersByTimeAsync(REMINDER_REPEAT_MS)})
    expect(notify).toHaveBeenCalledTimes(1)
    offline = false; state = 'cancelled'
    await act(async () => {await vi.advanceTimersByTimeAsync(15_000)})
    expect(notify).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(sound.stop).toHaveBeenCalled()
  })
})
