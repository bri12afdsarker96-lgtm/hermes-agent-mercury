import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DoudianController } from './doudian-host'
import type { DoudianRequest } from './doudian-types'

const executable = process.env.HERMES_PAYMENT_TEST_HOST

it.skipIf(process.platform !== 'win32' || !executable).each(['resumePayment', 'stop'] as const)(
  'routes pausePayment and %s through the real controller and host workflow', async action => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-payment-pipe-'))
    const workbook = path.join(root, 'fixture', 'synthetic.xlsx')
    const previousRoot = process.env.HERMES_PAYMENT_PIPE_ROOT
    const previousMode = process.env.HERMES_PAYMENT_PIPE_MODE
    process.env.HERMES_PAYMENT_PIPE_ROOT = root
    process.env.HERMES_PAYMENT_PIPE_MODE = 'pause-resume'
    const controller = new DoudianController({
      platform: 'win32', root, isCurrent: () => true, authorize: async () => 'a'.repeat(64),
      chooseWorkbook: async () => workbook, verify: async () => executable!
    })
    const call = (request: Omit<DoudianRequest, 'sessionId'>) => controller.operate({ ...request, sessionId: 'fixture' })
    const waitForState = async (state: string) => vi.waitFor(async () => {
      const reply = await call({ action: 'status' })
      expect(reply).toMatchObject({ ok: true, task: { kind: 'payment', state } })
    }, { timeout: 5000, interval: 20 })
    const callsFile = path.join(root, 'fixture', 'calls.txt')
    const savedFile = path.join(root, 'fixture', 'persisted.json')
    try {
      const capabilities = await call({ action: 'capabilities' })
      expect(capabilities.error).toBeUndefined()
      expect(capabilities).toMatchObject({ ok: true, capabilities: { paymentControls: 1 } })
      const selected = await call({ action: 'chooseWorkbook' })
      expect(selected.ok).toBe(true)
      const prepared = await call({ action: 'preparePayment', workbookId: selected.workbook!.id, amount: '3.25', startRow: '2', maxRows: '0', mode: 'standard' })
      expect(prepared.ok).toBe(true)
      const taskId = prepared.task!.taskId!
      await waitForState('awaiting_confirmation')
      expect((await call({ action: 'startPayment', taskId })).ok).toBe(true)
      await vi.waitFor(async () => expect(await fs.readFile(callsFile, 'utf8')).toBe('confirm\n'))
      expect(await call({ action: 'pausePayment', taskId })).toMatchObject({ ok: true, task: { taskId, kind: 'payment' } })
      await waitForState('paused')
      const paused = JSON.parse(await fs.readFile(savedFile, 'utf8'))
      expect(paused['2']).toContain('需人工核验')
      expect(paused['3']).toBeUndefined()
      expect(await fs.readFile(callsFile, 'utf8')).toBe('confirm\n')
      expect(await call({ action: 'openPayment' })).toEqual({ ok: false, error: 'TASK_BUSY' })
      expect(await call({ action: 'openReview' })).toEqual({ ok: false, error: 'TASK_BUSY' })
      expect(await call({ action: 'preparePayment', workbookId: selected.workbook!.id, amount: '1', startRow: '2', maxRows: '0', mode: 'new-order' }))
        .toEqual({ ok: false, error: 'TASK_BUSY' })
      expect(await call({ action, taskId })).toMatchObject({ ok: true, task: { taskId, kind: 'payment' } })
      await waitForState(action === 'resumePayment' ? 'completed' : 'stopped')
      const saved = JSON.parse(await fs.readFile(savedFile, 'utf8'))
      if (action === 'resumePayment') {
        expect(saved['2']).toMatch(/^已打款/)
        expect(saved['3']).toMatch(/^已打款/)
        expect(await fs.readFile(callsFile, 'utf8')).toBe('confirm\nsecond-confirm\nconfirm\nsecond-confirm\n')
      } else {
        expect(saved['2']).toContain('需人工核验')
        expect(saved['3']).toBeUndefined()
        expect(await fs.readFile(callsFile, 'utf8')).toBe('confirm\n')
      }
    } finally {
      controller.close()
      if (previousRoot === undefined) delete process.env.HERMES_PAYMENT_PIPE_ROOT
      else process.env.HERMES_PAYMENT_PIPE_ROOT = previousRoot
      if (previousMode === undefined) delete process.env.HERMES_PAYMENT_PIPE_MODE
      else process.env.HERMES_PAYMENT_PIPE_MODE = previousMode
    }
  }, 15000
)

it.skipIf(process.platform !== 'win32' || !executable)('starts without Esc and routes stop through the real host pipe while preserving the unresolved row', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-payment-pipe-'))
  const workbook = path.join(root, 'fixture', 'synthetic.xlsx')
  const oldRoot = process.env.HERMES_PAYMENT_PIPE_ROOT
  const oldMode = process.env.HERMES_PAYMENT_PIPE_MODE
  process.env.HERMES_PAYMENT_PIPE_ROOT = root
  process.env.HERMES_PAYMENT_PIPE_MODE = 'esc-stop'
  const controller = new DoudianController({
    platform: 'win32', root, isCurrent: () => true, authorize: async () => 'a'.repeat(64),
    chooseWorkbook: async () => workbook, verify: async () => executable!
  })
  const call = (request: Omit<DoudianRequest, 'sessionId'>) => controller.operate({ ...request, sessionId: 'fixture' })
  try {
    const selected = await call({ action: 'chooseWorkbook' })
    const prepared = await call({ action: 'preparePayment', workbookId: selected.workbook!.id, amount: '3.25', startRow: '2', maxRows: '0', mode: 'standard' })
    expect(prepared.ok).toBe(true)
    await vi.waitFor(async () => expect((await call({ action: 'status' })).task?.state).toBe('awaiting_confirmation'))
    expect((await call({ action: 'startPayment', taskId: prepared.task!.taskId! })).ok).toBe(true)
    await vi.waitFor(async () => expect(await fs.readFile(path.join(root, 'fixture', 'calls.txt'), 'utf8')).toBe('confirm\n'))
    expect((await call({ action: 'stop', taskId: prepared.task!.taskId! })).ok).toBe(true)
    await vi.waitFor(async () => expect((await call({ action: 'status' })).task?.state).toBe('stopped'), { timeout: 5000 })
    const saved = JSON.parse(await fs.readFile(path.join(root, 'fixture', 'persisted.json'), 'utf8'))
    expect(saved['2']).toContain('需人工核验')
    expect(saved['3']).toBeUndefined()
    expect(await fs.readFile(path.join(root, 'fixture', 'calls.txt'), 'utf8')).toBe('confirm\n')
  } finally {
    controller.close()
    if (oldRoot === undefined) delete process.env.HERMES_PAYMENT_PIPE_ROOT
    else process.env.HERMES_PAYMENT_PIPE_ROOT = oldRoot
    if (oldMode === undefined) delete process.env.HERMES_PAYMENT_PIPE_MODE
    else process.env.HERMES_PAYMENT_PIPE_MODE = oldMode
  }
}, 15000)

it.skipIf(process.platform !== 'win32' || !executable).each([['unknown', 'paused_review'], ['balance', 'paused_balance']])(
  'propagates %s from the real TD workflow through the controller', async (mode, expected) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-payment-pipe-'))
    const workbook = path.join(root, 'fixture', 'synthetic.xlsx')
    const oldRoot = process.env.HERMES_PAYMENT_PIPE_ROOT
    const oldMode = process.env.HERMES_PAYMENT_PIPE_MODE
    process.env.HERMES_PAYMENT_PIPE_ROOT = root
    process.env.HERMES_PAYMENT_PIPE_MODE = mode
    const controller = new DoudianController({
      platform: 'win32', root, isCurrent: () => true, authorize: async () => 'a'.repeat(64),
      chooseWorkbook: async () => workbook, verify: async () => executable!
    })
    const call = (request: Omit<DoudianRequest, 'sessionId'>) => controller.operate({ ...request, sessionId: 'fixture' })
    try {
      const selected = await call({ action: 'chooseWorkbook' })
      expect(selected.ok).toBe(true)
      const prepared = await call({ action: 'preparePayment', workbookId: selected.workbook!.id, amount: '3.25', startRow: '2', maxRows: '0', mode: 'standard' })
      expect(prepared.ok).toBe(true)
      await vi.waitFor(async () => expect((await call({ action: 'status' })).task?.state).toBe('awaiting_confirmation'))
      expect((await call({ action: 'startPayment', taskId: prepared.task!.taskId! })).ok).toBe(true)
      await vi.waitFor(async () => expect((await call({ action: 'status' })).task?.state).toBe(expected), { timeout: 5000 })
      const saved = JSON.parse(await fs.readFile(path.join(root, 'fixture', 'persisted.json'), 'utf8'))
      expect(saved['2']).toContain(mode === 'unknown' ? '需人工核验' : '未打款')
      expect(saved['3']).toBeUndefined()
      expect((await fs.readFile(path.join(root, 'fixture', 'calls.txt'), 'utf8')).trim().split(/\r?\n/)).toEqual(['confirm', 'second-confirm'])
    } finally {
      controller.close()
      if (oldRoot === undefined) delete process.env.HERMES_PAYMENT_PIPE_ROOT
      else process.env.HERMES_PAYMENT_PIPE_ROOT = oldRoot
      if (oldMode === undefined) delete process.env.HERMES_PAYMENT_PIPE_MODE
      else process.env.HERMES_PAYMENT_PIPE_MODE = oldMode
    }
  }, 15000
)
