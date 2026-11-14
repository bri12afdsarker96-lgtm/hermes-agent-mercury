import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { DoudianHost } from './doudian-host'

it('allows original WinForms windows to be visible when the host opens them', () => {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter & { resume(): void }; stdin: EventEmitter & { end(): void } }
  child.stdout = new EventEmitter()
  child.stderr = Object.assign(new EventEmitter(), { resume: vi.fn() })
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  spawnMock.mockReturnValue(child)
  const host = new DoudianHost('C:\\fixture\\host.exe')
  expect(spawnMock).toHaveBeenCalledWith('C:\\fixture\\host.exe', ['--hermes-review-host'],
    expect.objectContaining({ windowsHide: false, shell: false, stdio: 'pipe' }))
  host.close()
})
