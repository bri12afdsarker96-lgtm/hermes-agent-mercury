import { defineConfig } from 'vitest/config'

export default defineConfig({
  cacheDir: './.codex-vitest-cache/isolation',
  test: { environment: 'node', include: ['electron/**/*.test.ts'] }
})
