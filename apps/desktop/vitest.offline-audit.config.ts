import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Keep Vite's generated files in this worktree rather than a linked node_modules.
export default defineConfig({
  cacheDir: './.codex-vitest-cache/root',
  test: { projects: [
    { plugins: [react()], cacheDir: './.codex-vitest-cache/ui', test: { name: 'ui', environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], include: ['src/**/*.test.{ts,tsx}'], globals: true, testTimeout: 15000 } },
    { cacheDir: './.codex-vitest-cache/electron', test: { name: 'electron', environment: 'node', include: ['electron/**/*.test.ts', 'scripts/**.test.{ts,mjs}'] } }
  ] }
})
