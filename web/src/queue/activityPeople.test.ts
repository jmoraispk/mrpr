import { expect, test } from 'vitest'

import type { OverviewDiscussion, OverviewNote } from '../gitlab/mrOverview'
import { activityStats } from './activityPeople'

const person = (username: string, bot = false) => ({
  username,
  name: username.toUpperCase(),
  avatarUrl: null,
  bot,
})
const note = (id: number, who: ReturnType<typeof person> | null, at: string, system = false): OverviewNote => ({
  id,
  body: 'x',
  system,
  icon: null,
  createdAt: at,
  author: who,
  position: null,
})
const thread = (id: string, notes: OverviewNote[], resolved = false): OverviewDiscussion => ({
  id,
  resolvable: true,
  resolved,
  notes,
})

test('stats count human comments, unresolved threads, people by count, and the newest note', () => {
  const stats = activityStats([
    thread('a', [
      note(1, person('ana'), '2026-10-01T00:00:00Z'),
      note(2, person('li'), '2026-10-02T00:00:00Z'),
      note(3, person('ana'), '2026-10-03T00:00:00Z'),
    ]),
    thread('b', [note(4, person('li'), '2026-10-04T00:00:00Z')], true),
  ])
  expect(stats).toEqual({
    comments: 4,
    unresolved: 1,
    people: [
      { username: 'ana', name: 'ANA', count: 2 },
      { username: 'li', name: 'LI', count: 2 },
    ],
    last: '2026-10-04T00:00:00Z',
  })
})

test('bots and system notes are not people', () => {
  const stats = activityStats([
    {
      id: 'a',
      resolvable: false,
      resolved: false,
      notes: [
        note(1, person('ana'), '2026-10-01T00:00:00Z', true),
        note(2, person('ci', true), '2026-10-02T00:00:00Z'),
      ],
    },
  ])
  expect(stats.people).toEqual([])
  expect(stats.comments).toBe(0)
  expect(stats.unresolved).toBe(0)
})
