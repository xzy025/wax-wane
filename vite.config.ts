/// <reference types="vitest/config" />
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The 挥手研究 console (huishou-research.html -> src/huishouResearchMain.tsx) is
// a private strategy entry, gitignored in the public repo. Only register it as a
// build input when the file is actually present, so a clean public checkout
// still builds. `process.cwd()` is the Vite root here (no `root` override).
const buildInput: Record<string, string> = { main: 'index.html' }
if (existsSync(resolve(process.cwd(), 'huishou-research.html'))) {
  buildInput.huishouResearch = 'huishou-research.html'
}

// Use the IPv4 loopback explicitly on Windows. localhost may resolve to
 // ::1 while Express is listening on IPv4, surfacing as Failed to fetch.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3002'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 3000,
    headers: {
      // Avoid a corrupted/304'd Vite module leaving the dev app blank.
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': apiTarget,
    },
  },
  build: {
    rollupOptions: {
      input: buildInput,
      output: {
        // Split rarely-changing vendor code into cacheable chunks so app-code
        // changes don't invalidate the whole bundle. xlsx is excluded here:
        // it is dynamically imported in engine/csvParser.ts and code-splits on its own.
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')
          if (!normalized.includes('node_modules')) return undefined
          // Let rollup keep xlsx in its own lazy chunk (dynamic import target);
          // assigning it a manual chunk would pull it back into the eager bundle.
          if (normalized.includes('node_modules/xlsx/')) return undefined
          if (
            /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(
              normalized,
            )
          ) {
            return 'react-vendor'
          }
          if (/node_modules\/(recharts|victory-vendor|d3-[^/]+|recharts-scale)\//.test(normalized)) {
            return 'charts'
          }
          if (normalized.includes('node_modules/phosphor-react/')) {
            return 'icons'
          }
          return 'vendor'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Frontend tests live in src/ and run under jsdom. Server tests
    // (server/**/*.test.ts) use their own Node runner, so scope vitest to src/.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
