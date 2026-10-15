import { expect, test } from 'vitest'

import { GitLabClient } from '../gitlab/client'
import {
  API,
  createFakeGitLab,
  fakeMergeRequest,
  fakeNote,
  HOST,
} from '../test/fakeGitLab'
import { ITEM_CAP, mergeItems, pollHost, type PollHostInput } from './pollHost'
import type { HostInbox, InboxItem } from './types'

const NOW = new Date('2026-09-24T12:00:00.000Z')
const after = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString()
const DAY_MINUTES = 24 * 60

function poll(
  previous: HostInbox | null,
  now = NOW,
  overrides: Partial<PollHostInput> = {},
) {
  return pollHost({
    client: new GitLabClient(API, 'secret'),
    hostId: HOST,
    username: 'joao',
    previous,
    now,
    hideBots: true,
    ...overrides,
  })
}

const kinds = (state: HostInbox) =>
  state.items.map((item) => [item.kind, item.noteId])

test('the first poll turns only the last three days into items', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(1, {
      discussions: [
        {
          id: 'd1',
          notes: [
            fakeNote(10, 'ana', 'old question', hoursAgo(100)),
            fakeNote(11, 'ana', 'recent question', hoursAgo(2)),
          ],
        },
      ],
    }),
  )
  gitlab.lists.authored.push(1)

  const state = await poll(null)

  expect(kinds(state)).toEqual([['comment', 11]])
  expect(state.mrs['1']).toMatchObject({ maxSeenNoteId: 11, trackedUntil: null })
  expect(state.lastPollAt).toBe(NOW.toISOString())
  expect(gitlab.calls).toEqual(['Involved', 'events', 'Activity'])
})

test('the first poll announces no review requests', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(2))
  gitlab.lists.reviewing.push(2)

  const state = await poll(null)

  expect(state.items).toEqual([])
  expect(state.mrs['2'].roles).toEqual(['reviewer'])
})

test('a quiet poll is one request', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(1))
  gitlab.lists.authored.push(1)
  const first = await poll(null)
  gitlab.calls.length = 0

  const second = await poll(first, after(2))

  expect(gitlab.calls).toEqual(['Involved'])
  expect(second.items).toEqual(first.items)
})

test('a reply in an old thread is caught, even past the first page of discussions', async () => {
  const gitlab = createFakeGitLab()
  gitlab.setPageSize(2)
  const mine = {
    id: 'd-mine',
    notes: [fakeNote(20, 'joao', 'Should this be async?', hoursAgo(200))],
  }
  const mr = gitlab.add(
    fakeMergeRequest(2, {
      discussions: [
        { id: 'o1', notes: [fakeNote(21, 'bo', 'nit', hoursAgo(190))] },
        { id: 'o2', notes: [fakeNote(22, 'bo', 'nit', hoursAgo(180))] },
        { id: 'o3', notes: [fakeNote(23, 'bo', 'nit', hoursAgo(170))] },
        mine,
      ],
    }),
  )
  gitlab.lists.reviewing.push(2)
  const first = await poll(null)
  expect(first.items).toEqual([])

  mine.notes.push(fakeNote(30, 'ana', 'Yes, fixed', after(1).toISOString()))
  mr.updatedAt = after(1).toISOString()
  gitlab.calls.length = 0
  const second = await poll(first, after(2))

  expect(kinds(second)).toEqual([['reply', 30]])
  expect(second.items[0].discussionId).toBe('d-mine')
  expect(gitlab.calls).toEqual(['Involved', 'Activity', 'MoreDiscussions'])
})

test('a merged merge request yields one item and then goes quiet', async () => {
  const gitlab = createFakeGitLab()
  const mr = gitlab.add(fakeMergeRequest(3))
  gitlab.lists.authored.push(3)
  const first = await poll(null)
  expect(first.mrs['3'].state).toBe('opened')

  gitlab.lists.authored.length = 0
  mr.state = 'merged'
  mr.updatedAt = after(1).toISOString()
  mr.discussions.push({
    id: 's1',
    notes: [fakeNote(40, 'ana', 'merged', after(1).toISOString(), { system: true })],
  })
  gitlab.calls.length = 0
  const second = await poll(first, after(2))

  expect(kinds(second)).toEqual([['merged', null]])
  expect(second.mrs['3'].state).toBe('merged')
  expect(second.mrs['3'].trackedUntil).toBe(
    new Date(after(2).getTime() + 14 * 86_400_000).toISOString(),
  )
  expect(gitlab.calls).toEqual(['Involved', 'Activity'])

  gitlab.calls.length = 0
  const third = await poll(second, after(4))

  expect(gitlab.calls).toEqual(['Involved'])
  expect(gitlab.involvedQueries.at(-1)).toContain('m3: mergeRequest')
  expect(third.items).toHaveLength(1)
})

test('watching stops fourteen days after a merge request leaves the lists', async () => {
  const gitlab = createFakeGitLab()
  const mr = gitlab.add(fakeMergeRequest(3))
  gitlab.lists.authored.push(3)
  const first = await poll(null)
  gitlab.lists.authored.length = 0
  mr.updatedAt = after(1).toISOString()
  const second = await poll(first, after(2))
  gitlab.calls.length = 0

  const later = await poll(second, after(15 * DAY_MINUTES))

  expect(later.mrs['3']).toBeUndefined()
  expect(gitlab.involvedQueries.at(-1)).not.toContain('m3: mergeRequest')
  expect(gitlab.calls).toEqual(['Involved', 'events'])
})

test('a merge request GitLab no longer returns is dropped', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(4))
  gitlab.lists.authored.push(4)
  const first = await poll(null)

  gitlab.lists.authored.length = 0
  gitlab.mrs.delete(4)
  const second = await poll(first, after(2))

  expect(second.mrs['4']).toBeUndefined()
})

test('repeat polls never duplicate items and keep read marks', async () => {
  const gitlab = createFakeGitLab()
  const mr = gitlab.add(
    fakeMergeRequest(1, {
      discussions: [{ id: 'd1', notes: [fakeNote(11, 'ana', 'Q', hoursAgo(1))] }],
    }),
  )
  gitlab.lists.authored.push(1)
  const first = await poll(null)
  const read = {
    ...first,
    items: first.items.map((item) => ({ ...item, read: true })),
  }

  mr.updatedAt = after(1).toISOString()
  const second = await poll(read, after(2))

  expect(second.items).toHaveLength(1)
  expect(second.items[0].read).toBe(true)
})

test('a merge request the user commented on is watched for replies', async () => {
  const gitlab = createFakeGitLab()
  const thread = {
    id: 'd5',
    notes: [
      fakeNote(50, 'ana', 'Why?', hoursAgo(30)),
      fakeNote(51, 'joao', 'Because', hoursAgo(1)),
    ],
  }
  const mr = gitlab.add(fakeMergeRequest(5, { discussions: [thread] }))
  gitlab.events.push({ noteableId: 5, createdAt: hoursAgo(1) })

  const first = await poll(null)

  expect(first.items).toEqual([])
  expect(first.mrs['5']).toMatchObject({ roles: ['commenter'] })
  expect(first.mrs['5'].trackedUntil).not.toBeNull()

  thread.notes.push(fakeNote(52, 'ana', 'Got it', after(1).toISOString()))
  mr.updatedAt = after(1).toISOString()
  gitlab.calls.length = 0
  const second = await poll(first, after(2))

  expect(kinds(second)).toEqual([['reply', 52]])
  expect(gitlab.calls).toEqual(['Involved', 'Activity'])
})

test('a merge request newly awaiting review is announced once', async () => {
  const gitlab = createFakeGitLab()
  const first = await poll(null)

  gitlab.add(fakeMergeRequest(6, { updatedAt: after(1).toISOString() }))
  gitlab.lists.reviewing.push(6)
  const second = await poll(first, after(2))
  const third = await poll(second, after(4))

  expect(second.items.map((item) => item.id)).toEqual([`${HOST}:review:6`])
  expect(third.items).toHaveLength(1)
})

test('a merge request that joins later is read from the last poll onward', async () => {
  const gitlab = createFakeGitLab()
  const first = await poll(null)

  gitlab.add(
    fakeMergeRequest(8, {
      updatedAt: after(1).toISOString(),
      discussions: [
        {
          id: 'd8',
          notes: [
            fakeNote(80, 'ana', '@joao old ping', hoursAgo(5)),
            fakeNote(81, 'ana', '@joao can you look?', after(1).toISOString()),
          ],
        },
      ],
    }),
  )
  gitlab.lists.todos.push(8)
  const second = await poll(first, after(2))

  expect(kinds(second)).toEqual([['mention', 81]])
})

test('the inbox keeps the newest 500 items', () => {
  const make = (n: number): InboxItem => ({
    id: `${HOST}:${n}`,
    kind: 'comment',
    hostId: HOST,
    mrId: 1,
    project: 'g/p',
    iid: 1,
    mrTitle: 'x',
    discussionId: 'd',
    noteId: n,
    author: null,
    excerpt: '',
    createdAt: new Date(NOW.getTime() + n * 1000).toISOString(),
    webUrl: '',
    read: false,
  })
  const merged = mergeItems(
    [],
    Array.from({ length: 600 }, (_, n) => make(n)),
  )

  expect(merged).toHaveLength(ITEM_CAP)
  expect(merged[0].noteId).toBe(599)
  expect(merged.at(-1)?.noteId).toBe(100)
})

test('a reply that beats the next events check is still caught', async () => {
  // The user comments on a merge request they have no other link to, and a
  // reply lands before the 15-minute events check discovers that merge
  // request. The reply predates the last poll, but it is still unseen.
  const gitlab = createFakeGitLab()
  let state = await poll(null)
  const thread = { id: 'd9', notes: [fakeNote(91, 'joao', 'Why this?', after(1).toISOString())] }
  const mr = gitlab.add(
    fakeMergeRequest(9, { updatedAt: after(3).toISOString(), discussions: [thread] }),
  )
  gitlab.events.push({ noteableId: 9, createdAt: after(1).toISOString() })
  thread.notes.push(fakeNote(92, 'ana', 'Because of X', after(3).toISOString()))
  mr.updatedAt = after(3).toISOString()

  for (let minute = 2; minute <= 16; minute += 2) {
    state = await poll(state, after(minute))
  }

  expect(kinds(state)).toEqual([['reply', 92]])
})

test('a mention whose todo lands after the next poll is still caught', async () => {
  // GitLab raises the todo in a background job, a moment after the note.
  const gitlab = createFakeGitLab()
  const first = await poll(null)
  const second = await poll(first, after(16))
  gitlab.add(
    fakeMergeRequest(10, {
      updatedAt: after(15.5).toISOString(),
      discussions: [
        { id: 'd10', notes: [fakeNote(100, 'ana', '@joao look', after(15.5).toISOString())] },
      ],
    }),
  )
  gitlab.lists.todos.push(10)

  const third = await poll(second, after(18))

  expect(kinds(third)).toEqual([['mention', 100]])
})
