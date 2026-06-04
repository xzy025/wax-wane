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
    // Frontend tests live in src/. Exclude apps/server (NestJS specs that need
    // their own Node/Nest test runner, not jsdom).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
