import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The site is built by vite.site.config.ts. This config exists for vitest.
export default defineConfig(() => ({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs', 'api/**/*.test.ts'],
    setupFiles: './src/test/setup.ts',
  },
}))
