/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  build: {
    rollupOptions: {
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
