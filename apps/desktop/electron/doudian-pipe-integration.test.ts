import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, it, vi } from 'vitest'
import { DoudianController } from './doudian-host'
import type { DoudianRequest } from './doudian-types'

const executable = process.env.HERMES_TD_TEST_HOST

it.skipIf(process.platform !== 'win32' || !executable)(
  'runs the real controller and TD stdio dispatch with isolated fake engines', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-pipe-contract-'))
    const workbook = path.join(root, 'fixture.xlsx')
    const trace = path.join(root, 'trace.jsonl')
    const previous = process.env.HERMES_TEST_TRACE
    process.env.HERMES_TEST_TRACE = trace
    await fs.writeFile(workbook, 'synthetic workbook')
    const controller = new DoudianController({
      platform: 'win32', root, isCurrent: () => true, authorize: async () => 'a'.repeat(64),
      chooseWorkbook: async () => workbook, verify: async () => executable!
    })
    const call = (request: Omit<DoudianRequest, 'sessionId'>) => controller.operate({ ...request, sessionId: 'fixture' })
    const status = async (wanted: string) => vi.waitFor(async () => {
      const result = await call({ action: 'status' })
      expect(result.ok).toBe(true)
      expect(result.task?.state).toBe(wanted)
      return result.task!
    }, { timeout: 5000, interval: 20 })
    try {
      const selected = await call({ action: 'chooseWorkbook' })
      expect(selected.ok).toBe(true)
      const workbookId = selected.workbook!.id
      const first = await call({ action: 'preparePayment', workbookId, amount: '3.25', startRow: '2', maxRows: '5', mode: 'standard' })
      expect(first.task?.kind).toBe('payment')
      expect((await call({ action: 'stop', taskId: first.task!.taskId! })).task?.state).toBe('stopped')
      const review = await call({ action: 'prepare', workbookId, shopId: 'b'.repeat(32) })
      expect(review.task?.kind).toBe('review')
      const readyReview = await status('awaiting_confirmation')
      expect((await call({ action: 'startPayment', taskId: readyReview.taskId! })).ok).toBe(false)
      expect((await call({ action: 'start', taskId: readyReview.taskId! })).ok).toBe(true)
      await status('completed')

      const payment = await call({ action: 'preparePayment', workbookId, amount: '4.75', startRow: '7', maxRows: '13', mode: 'new-order' })
      expect(payment.task?.kind).toBe('payment')
      expect((await call({ action: 'start', taskId: payment.task!.taskId! })).ok).toBe(false)
      expect((await call({ action: 'startPayment', taskId: payment.task!.taskId! })).ok).toBe(true)
      await status('completed')

      const events = (await fs.readFile(trace, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
      expect(events.filter(event => event.action === 'review')).toHaveLength(1)
      expect(events.filter(event => event.action === 'payment')).toEqual([
        expect.objectContaining({ workbook, amount: '4.75', startRow: 7, maxRows: 13, detail: 'NewOrder' })
      ])
    } finally {
      controller.close()
      if (previous === undefined) delete process.env.HERMES_TEST_TRACE
      else process.env.HERMES_TEST_TRACE = previous
      if (path.dirname(path.resolve(root)).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase() ||
          !path.basename(root).startsWith('hermes-pipe-contract-') || (await fs.lstat(root)).isSymbolicLink()) {
        throw new Error('Unsafe test cleanup path')
      }
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 15000
)
