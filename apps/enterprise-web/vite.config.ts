import path from 'node:path'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const desktopSrc = path.resolve(__dirname, '../desktop/src')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': desktopSrc,
      '@hermes/shared': path.resolve(__dirname, '../shared/src')
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    fs: { allow: [path.resolve(__dirname, '..'), desktopSrc] },
    host: '127.0.0.1',
    port: 5185,
    strictPort: true
  }
})
