import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DoudianController } from './doudian-host'
import type { DoudianRequest } from './doudian-types'

const executable = process.env.HERMES_PAYMENT_TEST_HOST

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
