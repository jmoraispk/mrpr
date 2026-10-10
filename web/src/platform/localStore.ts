import type { KeyValueStore } from './types'

/**
 * `localStorage` as a `KeyValueStore`. The `storage` event only reports writes
 * made by *other* tabs, so writes from this tab are announced by hand.
 */
export function createLocalStore(
  storage: Storage = window.localStorage,
  prefix = 'delta:',
): KeyValueStore {
  const listeners = new Set<(keys: string[]) => void>()
  const emit = (keys: string[]) => {
    for (const listener of listeners) listener(keys)
  }
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== storage || !event.key?.startsWith(prefix)) return
    emit([event.key.slice(prefix.length)])
  })
  return {
    get: async <T,>(key: string) => {
      const raw = storage.getItem(prefix + key)
      return raw === null ? undefined : (JSON.parse(raw) as T)
    },
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) {
        storage.setItem(prefix + key, JSON.stringify(value))
      }
      emit(Object.keys(items))
    },
    remove: async (key) => {
      storage.removeItem(prefix + key)
      emit([key])
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
