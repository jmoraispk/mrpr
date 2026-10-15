import { vi } from 'vitest'

import type { DeltaMessage, DeltaResponse } from '../core/messages'
import type { KeyValueStore, Platform } from '../platform/types'

export function createMemoryStore(): KeyValueStore {
  const data = new Map<string, unknown>()
  const listeners = new Set<(keys: string[]) => void>()
  const emit = (keys: string[]) => listeners.forEach((listener) => listener(keys))
  return {
    get: async <T,>(key: string) => structuredClone(data.get(key)) as T | undefined,
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value))
      emit(Object.keys(items))
    },
    remove: async (key) => {
      data.delete(key)
      emit([key])
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** A site-like platform: no tokens, no host permissions, no reload. */
export function createFakePlatform(
  overrides: Partial<Platform> = {},
): Platform & { sent: DeltaMessage[] } {
  const sent: DeltaMessage[] = []
  return {
    sent,
    store: createMemoryStore(),
    needsToken: false,
    clientFor: vi.fn(),
    connectHost: vi.fn(async () => 'redirecting' as const),
    disconnectHost: vi.fn(async () => {}),
    showUnread: vi.fn(async () => {}),
    send: async (message): Promise<DeltaResponse> => {
      sent.push(message)
      return { ok: true, data: null }
    },
    ...overrides,
  }
}
