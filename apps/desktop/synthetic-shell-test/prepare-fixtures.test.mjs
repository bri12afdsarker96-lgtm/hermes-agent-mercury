import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { defaultFixtureSource, prepareFixtures } from './prepare-fixtures.mjs'

test('missing and altered fixture inputs fail before a destination is created', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hermes-fixture-validation-'))
  const source = path.join(root, 'source'), target = path.join(root, 'target')
  const review = path.join(source, 'td-final-review-fixture'), exe = path.join(review, 'HermesHostIsolationTests.exe')
  try {
    await mkdir(source)
    await assert.rejects(prepareFixtures(source, target), /Fixture missing or unreadable/)
    await mkdir(review)
    await writeFile(exe, 'not the approved synthetic fixture')
    await assert.rejects(prepareFixtures(source, target), /Fixture hash mismatch/)
    await assert.rejects(stat(target), error => error.code === 'ENOENT')
    await assert.rejects(prepareFixtures('relative', target), /absolute/)
  } finally {
    await unlink(exe).catch(() => {})
    await rmdir(review).catch(() => {})
    await rmdir(source).catch(() => {})
    await rmdir(root)
  }
})

test('an existing destination is never overwritten', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hermes-fixture-existing-'))
  const sentinel = path.join(root, 'sentinel')
  try {
    await writeFile(sentinel, 'preserve')
    await assert.rejects(prepareFixtures(defaultFixtureSource, root), error => error.code === 'EEXIST')
    assert.equal((await stat(sentinel)).size, 8)
  } finally {
    await unlink(sentinel)
    await rmdir(root)
  }
})
