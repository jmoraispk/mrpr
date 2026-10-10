import browser from 'webextension-polyfill'

import type { HostConfig } from '../extension/hosts'
import { emptyHostInbox } from './pollHost'
import {
  DEFAULT_SETTINGS,
  type HostInbox,
  type InboxItem,
  type InboxSettings,
  type InboxState,
  type InboxView,
} from './types'

/**
 * Written by the worker only. Hub pages read it through router ops, and may
 * listen for changes to it, but never write it.
 */
export const INBOX_KEY = 'inbox'
/** A page-owned preference, like `hubCollapsedGroups`. */
export const INBOX_SETTINGS_KEY = 'inboxSettings'

export async function loadInbox(): Promise<InboxState> {
  const stored = await browser.storage.local.get(INBOX_KEY)
  const value = stored[INBOX_KEY] as InboxState | undefined
  return value?.hosts ? value : { hosts: {} }
}

export async function loadSettings(): Promise<InboxSettings> {
  const stored = await browser.storage.local.get(INBOX_SETTINGS_KEY)
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[INBOX_SETTINGS_KEY] as Partial<InboxSettings> | undefined),
  }
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Every write to the inbox goes through here, one at a time. A poll spends
 * seconds on the network between reading the inbox and writing it back, and a
 * "mark read" landing in that gap would otherwise be overwritten.
 */
export function updateInbox(
  change: (state: InboxState) => InboxState,
): Promise<InboxState> {
  const run = queue.then(async () => {
    const next = change(await loadInbox())
    await browser.storage.local.set({ [INBOX_KEY]: next })
    return next
  })
  queue = run.catch(() => undefined)
  return run
}

function mapItems(
  state: InboxState,
  update: (item: InboxItem) => InboxItem,
): InboxState {
  return {
    hosts: Object.fromEntries(
      Object.entries(state.hosts).map(([id, host]) => [
        id,
        { ...host, items: host.items.map(update) },
      ]),
    ),
  }
}

export function unreadCount(state: InboxState): number {
  return Object.values(state.hosts).reduce(
    (total, host) => total + host.items.filter((item) => !item.read).length,
    0,
  )
}

export function markRead(state: InboxState, ids: string[]): InboxState {
  const wanted = new Set(ids)
  return mapItems(state, (item) =>
    wanted.has(item.id) && !item.read ? { ...item, read: true } : item,
  )
}

export function markAllRead(state: InboxState): InboxState {
  return mapItems(state, (item) => (item.read ? item : { ...item, read: true }))
}

export function commitHost(
  state: InboxState,
  hostId: string,
  next: HostInbox,
): InboxState {
  const readIds = new Set(
    (state.hosts[hostId]?.items ?? [])
      .filter((item) => item.read)
      .map((item) => item.id),
  )
  return {
    hosts: {
      ...state.hosts,
      [hostId]: {
        ...next,
        items: next.items.map((item) =>
          !item.read && readIds.has(item.id) ? { ...item, read: true } : item,
        ),
      },
    },
  }
}

export function recordHostError(
  state: InboxState,
  hostId: string,
  error: { code: string; message: string },
): InboxState {
  const current = state.hosts[hostId] ?? emptyHostInbox()
  return { hosts: { ...state.hosts, [hostId]: { ...current, error } } }
}

export function pruneHosts(state: InboxState, hostIds: string[]): InboxState {
  const keep = new Set(hostIds)
  return {
    hosts: Object.fromEntries(
      Object.entries(state.hosts).filter(([id]) => keep.has(id)),
    ),
  }
}

export function inboxView(state: InboxState, hosts: HostConfig[]): InboxView {
  const items = hosts
    .flatMap((host) => state.hosts[host.id]?.items ?? [])
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return {
    hosts: hosts.map((host) => ({
      hostId: host.id,
      host: host.host,
      lastPollAt: state.hosts[host.id]?.lastPollAt ?? null,
      error: state.hosts[host.id]?.error ?? null,
    })),
    items,
    unread: items.filter((item) => !item.read).length,
  }
}
