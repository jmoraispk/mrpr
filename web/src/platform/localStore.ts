import type { KeyValueStore } from './types'

/** What the prefix was before the project was renamed from Delta to Mr. PR. */
const LEGACY_PREFIX = 'delta:'

/**
 * Move anything still written under the old prefix across to the new one, so a
 * visitor who signed in before the rename keeps their tokens instead of being
 * logged out. Runs before the store serves its first read. A new-prefix key
 * that already exists wins: it is the fresher of the two, and a stale
 * `delta:auth` left behind by an old tab must never overwrite it. Every
 * `localStorage` call can throw — private browsing, blocked site data — so the
 * whole pass is best-effort and a failure just leaves the store as it was.
 */
function migrateLegacyKeys(storage: Storage, prefix: string): void {
  if (prefix === LEGACY_PREFIX) return
  try {
    const legacy: string[] = []
    for (let at = 0; at < storage.length; at += 1) {
      const key = storage.key(at)
      if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key)
    }
    for (const key of legacy) {
      const moved = prefix + key.slice(LEGACY_PREFIX.length)
      const value = storage.getItem(key)
      if (value !== null && storage.getItem(moved) === null) storage.setItem(moved, value)
      storage.removeItem(key)
    }
  } catch {
    // Storage is unavailable; the app falls back to a signed-out first visit.
  }
}

/**
 * `localStorage` as a `KeyValueStore`. The `storage` event only reports writes
 * made by *other* tabs, so writes from this tab are announced by hand.
 */
export function createLocalStore(
  storage: Storage = window.localStorage,
  prefix = 'mrpr:',
): KeyValueStore {
  migrateLegacyKeys(storage, prefix)
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
