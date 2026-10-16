import { afterEach, expect, test } from 'vitest'

import { createLocalStore } from './localStore'

afterEach(() => localStorage.clear())

test('values round-trip as JSON under a prefix', async () => {
  const store = createLocalStore()
  await store.set({ inbox: { hosts: {} }, n: 3 })

  await expect(store.get('inbox')).resolves.toEqual({ hosts: {} })
  expect(localStorage.getItem('mrpr:n')).toBe('3')
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
    new StorageEvent('storage', { key: 'mrpr:inbox', storageArea: localStorage }),
  )
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'unrelated', storageArea: localStorage }),
  )

  expect(seen).toEqual([['inbox']])
})

test('a store written before the rename is read back under the new prefix', async () => {
  localStorage.setItem('delta:auth', JSON.stringify({ 'gitlab.example.com': 'token' }))
  localStorage.setItem('unrelated', 'kept')

  const store = createLocalStore()

  await expect(store.get('auth')).resolves.toEqual({ 'gitlab.example.com': 'token' })
  expect(localStorage.getItem('delta:auth')).toBeNull()
  expect(localStorage.getItem('unrelated')).toBe('kept')
})

test('a stale key from before the rename never clobbers what is stored now', async () => {
  localStorage.setItem('delta:auth', JSON.stringify('stale'))
  localStorage.setItem('mrpr:auth', JSON.stringify('current'))

  const store = createLocalStore()

  await expect(store.get('auth')).resolves.toBe('current')
  expect(localStorage.getItem('delta:auth')).toBeNull()
})

test('storage that throws leaves the store usable', async () => {
  const store = createLocalStore({
    get length(): number {
      throw new DOMException('denied', 'SecurityError')
    },
    key: () => null,
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  } as unknown as Storage)

  await expect(store.get('auth')).resolves.toBeUndefined()
})
