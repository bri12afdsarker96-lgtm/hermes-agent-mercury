import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4185', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
  webServer: {
    command: `npm run preview -- --outDir ${process.env.WEB_TEST_DIST ?? 'dist-web-0.20.8'} --port 4185 --strictPort`,
    url: 'http://127.0.0.1:4185',
    reuseExistingServer: false,
    timeout: 30000
  }
})
