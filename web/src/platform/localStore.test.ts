import { afterEach, expect, test } from 'vitest'

import { createLocalStore } from './localStore'

afterEach(() => localStorage.clear())

test('values round-trip as JSON under a prefix', async () => {
  const store = createLocalStore()
  await store.set({ inbox: { hosts: {} }, n: 3 })

  await expect(store.get('inbox')).resolves.toEqual({ hosts: {} })
  expect(localStorage.getItem('delta:n')).toBe('3')
  await store.remove('n')
  await expect(store.get('n')).resolves.toBeUndefined()
})

test('a write in this tab is reported to subscribers', async () => {
  const store = createLocalStore()
  const seen: string[][] = []
  const stop = store.subscribe((keys) => seen.push(keys))

  await store.set({ a: 1, b: 2 })
  await store.remove('a')
  stop()
  await store.set({ c: 3 })

  expect(seen).toEqual([['a', 'b'], ['a']])
})

test('a write in another tab arrives through the storage event', () => {
  const store = createLocalStore()
  const seen: string[][] = []
  store.subscribe((keys) => seen.push(keys))

  window.dispatchEvent(
    new StorageEvent('storage', { key: 'delta:inbox', storageArea: localStorage }),
  )
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'unrelated', storageArea: localStorage }),
  )

  expect(seen).toEqual([['inbox']])
})
