import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReminderSound } from './reminder-sound'
afterEach(() => vi.unstubAllGlobals())
describe('local reminder cue', () => {
  it('coalesces overlapping alerts, stops on logout, and can play again', async () => {
    const play = vi.fn(async () => {})
    const pause = vi.fn()
    const AudioMock = vi.fn(function (_url: string) {return { play, pause, removeAttribute:vi.fn(), load:vi.fn() }})
    vi.stubGlobal('Audio', AudioMock)
    const sound = new ReminderSound()
    expect(await sound.play()).toBe(true)
    expect(await sound.play()).toBe(true)
    expect(play).toHaveBeenCalledTimes(1)
    sound.stop()
    expect(pause).toHaveBeenCalledTimes(1)
    await sound.play()
    expect(play).toHaveBeenCalledTimes(2)
    expect(AudioMock.mock.calls[0][0]).not.toMatch(/^https?:/)
  })
  it('reports blocked audio without throwing and allows retry', async () => {
    vi.stubGlobal('Audio', vi.fn(function () {return {play: vi.fn(async () => {throw new Error('blocked')}), pause: vi.fn()}}))
    const sound = new ReminderSound()
    expect(await sound.play()).toBe(false)
    expect(await sound.play()).toBe(false)
  })
})
