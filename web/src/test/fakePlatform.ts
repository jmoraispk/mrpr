import { vi } from 'vitest'

import type { MrprMessage, MrprResponse } from '../core/messages'
import { GitLabClient } from '../gitlab/client'
import { GitLabError } from '../gitlab/errors'
import { installPlatform } from '../platform/platform'
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
): Platform & { sent: MrprMessage[] } {
  const sent: MrprMessage[] = []
  return {
    sent,
    store: createMemoryStore(),
    needsToken: false,
    clientFor: vi.fn(),
    connectHost: vi.fn(async () => 'redirecting' as const),
    disconnectHost: vi.fn(async () => {}),
    showUnread: vi.fn(async () => {}),
    send: async (message): Promise<MrprResponse> => {
      sent.push(message)
      return { ok: true, data: null }
    },
    ...overrides,
  }
}

/**
 * A fake platform, installed as the current one, whose GitLab clients use the
 * token stored with each host: what the shared core (router, poller, store)
 * needs to run against the fake GitLab. Its showUnread is a mock to assert on.
 */
export function installTestPlatform(): Platform & { sent: MrprMessage[] } {
  const fake = createFakePlatform({
    clientFor: async (host) => {
      const { getToken } = await import('../core/hosts')
      const token = await getToken(host.id)
      if (!token) throw new GitLabError(401, 'Not signed in to this host.', 'host_not_configured')
      return new GitLabClient(host.apiBase, token)
    },
    showUnread: vi.fn(async () => {}),
  })
  installPlatform(fake)
  return fake
}
