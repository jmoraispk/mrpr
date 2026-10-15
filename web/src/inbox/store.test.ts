import { beforeEach, expect, test, vi } from 'vitest'

import { createFakeBrowser } from '../test/fakeBrowser'
import type { HostInbox, InboxItem, InboxState } from './types'

const fake = createFakeBrowser()
vi.mock('webextension-polyfill', () => ({ default: fake }))
await import('../test/installExtensionPlatform')

const {
  commitHost,
  inboxView,
  loadInbox,
  loadSettings,
  markAllRead,
  markRead,
  pruneHosts,
  recordHostError,
  unreadCount,
  updateInbox,
} = await import('./store')

beforeEach(() => fake.reset())

function item(hostId: string, n: number, read = false): InboxItem {
  return {
    id: `${hostId}:${n}`,
    kind: 'comment',
    hostId,
    mrId: 1,
    project: 'g/p',
    iid: 1,
    mrTitle: 'x',
    discussionId: 'd',
    noteId: n,
    author: null,
    excerpt: '',
    createdAt: new Date(Date.UTC(2026, 8, 24, 12, n)).toISOString(),
    webUrl: '',
    read,
  }
}

function host(items: InboxItem[], extra: Partial<HostInbox> = {}): HostInbox {
  return {
    lastPollAt: '2026-09-24T12:00:00.000Z',
    lastEventsAt: null,
    mrs: {},
    items,
    error: null,
    ...extra,
  }
}

const A = 'a.example.com'
const B = 'b.example.com'
const state: InboxState = {
  hosts: { [A]: host([item(A, 2), item(A, 1, true)]), [B]: host([item(B, 3)]) },
}

test('unread is counted across hosts', () => {
  expect(unreadCount(state)).toBe(2)
})

test('marking read touches only the named items', () => {
  const next = markRead(state, [`${A}:2`])
  expect(next.hosts[A].items.map((value) => value.read)).toEqual([true, true])
  expect(next.hosts[B].items[0].read).toBe(false)
  expect(unreadCount(markAllRead(state))).toBe(0)
})

test('a poll result keeps read marks made while it ran', () => {
  const polled = host([item(A, 4), item(A, 2), item(A, 1)])
  const next = commitHost(markRead(state, [`${A}:2`]), A, polled)
  expect(next.hosts[A].items.map((value) => [value.noteId, value.read])).toEqual([
    [4, false],
    [2, true],
    [1, true],
  ])
})

test('an error keeps the items a host already had', () => {
  const next = recordHostError(state, A, { code: 'gitlab_timeout', message: 'slow' })
  expect(next.hosts[A].error).toEqual({ code: 'gitlab_timeout', message: 'slow' })
  expect(next.hosts[A].items).toHaveLength(2)
  expect(recordHostError({ hosts: {} }, A, { code: 'x', message: 'y' }).hosts[A])
    .toMatchObject({ items: [], lastPollAt: null, error: { code: 'x' } })
})

test('hosts no longer configured are pruned', () => {
  expect(Object.keys(pruneHosts(state, [B]).hosts)).toEqual([B])
})

test('the hub view merges configured hosts, newest first', () => {
  const view = inboxView(state, [
    { id: A, host: A, apiBase: '', userId: 1, username: 'j' },
  ])
  expect(view.items.map((value) => value.id)).toEqual([`${A}:2`, `${A}:1`])
  expect(view.unread).toBe(1)
  expect(view.hosts).toEqual([
    { hostId: A, host: A, lastPollAt: '2026-09-24T12:00:00.000Z', error: null },
  ])
})

test('concurrent updates are applied one after the other', async () => {
  await Promise.all([
    updateInbox((value) => ({ hosts: { ...value.hosts, [A]: host([]) } })),
    updateInbox((value) => ({ hosts: { ...value.hosts, [B]: host([]) } })),
  ])
  expect(Object.keys((await loadInbox()).hosts).sort()).toEqual([A, B])
})

test('settings default to hiding bots', async () => {
  expect(await loadSettings()).toEqual({ hideBots: true })
  fake.data.inboxSettings = { hideBots: false }
  expect(await loadSettings()).toEqual({ hideBots: false })
})

test('the view names merged and closed merge requests, and ignores ones stored without a state', () => {
  const tracked = (id: number, state?: string) => ({
    id, iid: id, project: 'g/p', title: 'x', webUrl: '', updatedAt: '', roles: [],
    maxSeenNoteId: 0, trackedUntil: null, ...(state ? { state } : {}),
  })
  const view = inboxView(
    { hosts: { [A]: host([], { mrs: { 1: tracked(1, 'merged'), 2: tracked(2, 'opened'), 3: tracked(3, 'closed'), 4: tracked(4) } }) } },
    [{ id: A, host: A, apiBase: '', userId: 1, username: 'j' }],
  )
  expect(view.closed.sort()).toEqual([`${A}:1`, `${A}:3`])
})
