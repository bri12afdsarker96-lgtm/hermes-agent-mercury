import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareFiles, inventory } from './verify-doudian-package.mjs'

test('empty extracted module reports every expected file missing and fails closed', () => {
  const expected = [{ path: 'inference/model/file.bin', bytes: 1, sha256: 'a'.repeat(64) }]
  const report = compareFiles(expected, [])
  assert.equal(report.passed, false)
  assert.equal(report.rows[0].status, 'missing')
  assert.throws(() => compareFiles([], []), /Empty module contract/)
})

test('real extracted module copy detects one deleted nested model', {
  skip: !process.env.TD_AUDIT_ORIGINAL || !process.env.TD_AUDIT_MISSING_COPY,
}, async () => {
  const original = await inventory(process.env.TD_AUDIT_ORIGINAL)
  const modified = await inventory(process.env.TD_AUDIT_MISSING_COPY)
  const report = compareFiles(original, modified)
  assert.equal(report.passed, false)
  assert.equal(report.expected_count, 85)
  assert.equal(report.actual_count, 84)
  assert.deepEqual(report.rows.filter(row => row.status !== 'ok').map(row => [row.status, row.path]),
    [['missing', 'inference/PP-OCRv5_mobile_det_infer/inference.pdiparams']])
})
