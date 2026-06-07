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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Frontend tests live in src/ and run under jsdom. Server tests
    // (server/**/*.test.ts) use their own Node runner, so scope vitest to src/.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
