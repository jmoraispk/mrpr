import { expect, test, vi } from 'vitest'

test('using the platform before installing one says so', async () => {
  vi.resetModules()
  const fresh = await import('./platform')
  expect(() => fresh.platform()).toThrow('No platform installed')
})
