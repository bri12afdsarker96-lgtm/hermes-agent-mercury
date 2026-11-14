import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pins = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8'))
export async function prepareFixtures(sourceRoot, destination) {
  if (!path.isAbsolute(sourceRoot) || !path.isAbsolute(destination)) throw new Error('Fixture paths must be absolute')
  const verified = []
  for (const kind of ['review', 'payment']) {
    for (const item of [pins[kind], pins.dll]) {
      const source = path.join(sourceRoot, pins[kind].directory, item.file)
      let bytes
      try { bytes = await readFile(source) } catch (error) { throw new Error(`Fixture missing or unreadable: ${source}`, { cause: error }) }
      if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Fixture hash mismatch: ${source}`)
      verified.push({ directory: pins[kind].directory, name: item.file, bytes })
    }
  }
  // Only create a new output directory after every input has passed the fixed pins.
  await mkdir(destination)
  for (const kind of ['review', 'payment']) await mkdir(path.join(destination, pins[kind].directory))
  for (const item of verified) await writeFile(path.join(destination, item.directory, item.name), item.bytes, { flag: 'wx' })
  return pins
}

export const defaultFixtureSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', 'hermes-enterprise-synthetic-shell-20261115', 'results')
