import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // `__DELTA_DEV__` belongs to the extension build; this config builds the SPA
  // the Python CLI serves, which never reads it. Defining it false anyway keeps
  // a stray reference from the SPA's import graph — which type-checks and tests
  // clean, see web/src/globals.d.ts — from becoming a runtime ReferenceError in
  // the shipped product.
  //
  // Only under `build`. Vitest loads this config with command `serve`, and a
  // define substitutes the identifier textually in module source, so it would
  // beat `vi.stubGlobal` and pin every test to the release branch.
  define: command === 'build' ? { __DELTA_DEV__: 'false' } : {},
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
