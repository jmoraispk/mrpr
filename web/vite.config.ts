import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(() => ({
  plugins: [react()],
  build: {
    outDir: '../src/delta_review/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1100,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs', 'api/**/*.test.ts'],
    setupFiles: './src/test/setup.ts',
  },
}))
