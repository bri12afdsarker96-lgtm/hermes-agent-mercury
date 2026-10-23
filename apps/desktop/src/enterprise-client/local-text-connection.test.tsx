import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { LocalTextReply } from '../../electron/enterprise-local-text-types'
import { useLocalTextConnection } from './local-text-connection'
import type { EnterpriseClientRuntime } from './runtime'

const connected: LocalTextReply = { state: 'connected', modelStatus: 'unverified' }
const supported: LocalTextReply = { state: 'ready', modelStatus: 'supported' }
const runtimeFor = (localText: NonNullable<EnterpriseClientRuntime['localText']>) => ({ localText }) as EnterpriseClientRuntime

it('model preflight hook keeps a superseding refresh from getting stuck while an explicit check finishes', async () => {
  let release!: (reply: LocalTextReply) => void
  const held = new Promise<LocalTextReply>(done => {release = done})
  let status = connected
  const localText = vi.fn(async (payload: { action: string }) => payload.action === 'checkModel' ? held : status)
  const runtime = runtimeFor(localText)
  const view = renderHook(() => useLocalTextConnection(runtime))
  await waitFor(() => expect(view.result.current.state.modelStatus).toBe('unverified'))
  vi.useFakeTimers()
  try {
    let running!: Promise<void>
    act(() => {running = view.result.current.command('checkModel')})
    await act(async () => {await view.result.current.command('checkModel')})
    expect(localText.mock.calls.filter(([payload]) => payload.action === 'checkModel')).toHaveLength(1)
    status = { state: 'connected', modelStatus: 'checking' }
    await act(async () => {await view.result.current.refresh()})
    await act(async () => {status = supported; release(supported); await running})
    expect(view.result.current.state.modelStatus).toBe('checking')
    await act(async () => {await vi.advanceTimersByTimeAsync(2000)})
    expect(view.result.current.state.modelStatus).toBe('supported')
    expect(localText.mock.calls.filter(([payload]) => payload.action === 'checkModel')).toHaveLength(1)
  } finally {view.unmount(); vi.useRealTimers()}
})

it('model preflight hook drops old runtime support and does not auto-check the replacement', async () => {
  let release!: (reply: LocalTextReply) => void
  const held = new Promise<LocalTextReply>(done => {release = done})
  const oldCall = vi.fn(async (payload: { action: string }) => payload.action === 'checkModel' ? held : connected)
  const newCall = vi.fn(async () => connected)
  const view = renderHook(({ runtime }) => useLocalTextConnection(runtime), { initialProps: { runtime: runtimeFor(oldCall) } })
  await waitFor(() => expect(view.result.current.state.modelStatus).toBe('unverified'))
  let running!: Promise<void>
  act(() => {running = view.result.current.command('checkModel')})
  view.rerender({ runtime: runtimeFor(newCall) })
  await act(async () => {release(supported); await running})
  expect(view.result.current.state.modelStatus).toBe('unverified')
  expect(newCall.mock.calls).toHaveLength(1)
  view.unmount()
})

it('model preflight hook resumes after a held status poll is superseded by refresh', async () => {
  let releaseCheck!: (reply: LocalTextReply) => void
  let releasePoll!: (reply: LocalTextReply) => void
  const heldCheck = new Promise<LocalTextReply>(done => {releaseCheck = done})
  const heldPoll = new Promise<LocalTextReply>(done => {releasePoll = done})
  let statusCalls = 0
  let serverState = connected
  const localText = vi.fn(async (payload: { action: string }) => {
    if (payload.action === 'checkModel') {return heldCheck}
    statusCalls += 1
    return statusCalls === 2 ? heldPoll : serverState
  })
  const runtime = runtimeFor(localText)
  const view = renderHook(() => useLocalTextConnection(runtime))
  await waitFor(() => expect(view.result.current.state.modelStatus).toBe('unverified'))
  vi.useFakeTimers()
  try {
    let running!: Promise<void>
    act(() => {running = view.result.current.command('checkModel')})
    await act(async () => {await vi.advanceTimersByTimeAsync(2000)})
    expect(statusCalls).toBe(2)
    serverState = { state: 'connected', modelStatus: 'checking' }
    await act(async () => {await view.result.current.refresh()})
    await act(async () => {releasePoll(serverState); await heldPoll})
    await act(async () => {serverState = supported; releaseCheck(supported); await running})
    await act(async () => {await vi.advanceTimersByTimeAsync(2000)})
    expect(view.result.current.state.modelStatus).toBe('supported')
    expect(localText.mock.calls.filter(([payload]) => payload.action === 'checkModel')).toHaveLength(1)
  } finally {view.unmount(); vi.useRealTimers()}
})
