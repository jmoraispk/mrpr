import { expect, test } from 'vitest'

import type { OverviewDiscussion, OverviewNote } from '../gitlab/mrOverview'
import { buildActivity, DEFAULT_FILTERS, toThreadDiscussion, waitingOnYou } from './activity'

let n = 0
function note(
  author: string,
  body: string,
  createdAt: string,
  extra: Partial<OverviewNote> = {},
): OverviewNote {
  n += 1
  return {
    id: n,
    body,
    system: false,
    icon: null,
    createdAt,
    author: { username: author, name: author, avatarUrl: null, bot: false },
    position: null,
    ...extra,
  }
}
function thread(
  id: string,
  notes: OverviewNote[],
  extra: Partial<OverviewDiscussion> = {},
): OverviewDiscussion {
  return { id, resolvable: true, resolved: false, notes, ...extra }
}
const sys = (icon: string, at: string) =>
  thread(`s-${icon}-${at}`, [note('ana', `${icon} happened`, at, { system: true, icon })], {
    resolvable: false,
  })
const opts = { me: 'joao', since: null, filters: DEFAULT_FILTERS }
const ids = (items: ReturnType<typeof buildActivity>['items']) =>
  items.map((i) => (i.kind === 'thread' ? i.discussion.id : i.category))

test('items come in time order: threads by their first note, events by theirs', () => {
  const a = buildActivity(
    [
      thread('t2', [note('li', 'later', '2026-10-11T10:00:00Z')]),
      sys('commit', '2026-10-11T09:00:00Z'),
      thread('t1', [note('li', 'first', '2026-10-11T08:00:00Z')]),
    ],
    opts,
  )
  expect(ids(a.items)).toEqual(['t1', 'commits', 't2'])
})

test('defaults hide resolved threads and bots, and count them', () => {
  const a = buildActivity(
    [
      thread('open', [note('li', 'q', '2026-10-11T08:00:00Z')]),
      thread('done', [note('li', 'ok', '2026-10-11T08:01:00Z')], { resolved: true }),
      thread('bot', [
        note('renovate', 'bump', '2026-10-11T08:02:00Z', {
          author: { username: 'renovate', name: 'Renovate', avatarUrl: null, bot: true },
        }),
      ]),
      sys('pencil', '2026-10-11T08:03:00Z'),
    ],
    opts,
  )
  expect(ids(a.items)).toEqual(['open', 'other'])
  expect(a.hidden).toEqual({ resolved: 1, bots: 1, commits: 0, other: 0 })
})

test('each option can show or hide its kind', () => {
  const filters = { unresolved: true, resolved: true, commits: false, bots: true, other: false }
  const a = buildActivity(
    [
      sys('commit', '2026-10-11T08:00:00Z'),
      sys('user', '2026-10-11T08:01:00Z'),
      thread('done', [note('li', 'ok', '2026-10-11T08:02:00Z')], { resolved: true }),
    ],
    { ...opts, filters },
  )
  expect(a.items.map((i) => i.category)).toEqual(['resolved'])
  expect(a.hidden).toEqual({ resolved: 0, bots: 0, commits: 1, other: 1 })
})

test('reveal shows everything, with nothing counted as hidden', () => {
  const a = buildActivity(
    [thread('done', [note('li', 'ok', '2026-10-11T08:00:00Z')], { resolved: true })],
    { ...opts, reveal: true },
  )
  expect(a.items).toHaveLength(1)
  expect(a.hidden.resolved).toBe(0)
})

test('the divider sits before the first item newer than your last look; older threads with new replies are marked new', () => {
  const a = buildActivity(
    [
      thread('old', [note('li', 'q', '2026-10-11T08:00:00Z'), note('ana', 'a', '2026-10-11T11:00:00Z')]),
      thread('older-quiet', [note('li', 'x', '2026-10-11T08:30:00Z')]),
      sys('commit', '2026-10-11T10:00:00Z'),
    ],
    { ...opts, since: '2026-10-11T09:00:00Z' },
  )
  expect(a.dividerBefore).toBe(2)
  expect(a.items.map((i) => i.isNew)).toEqual([true, false, true])
})

test('no last look, no divider', () => {
  const a = buildActivity([thread('t', [note('li', 'q', '2026-10-11T08:00:00Z')])], opts)
  expect(a.dividerBefore).toBeNull()
})

test('threads involving you say how', () => {
  const a = buildActivity(
    [
      thread('m', [note('li', 'what do you think @joao?', '2026-10-11T08:00:00Z')]),
      thread('r', [note('li', 'q', '2026-10-11T08:01:00Z'), note('joao', 'a', '2026-10-11T08:02:00Z')]),
      thread('s', [note('joao', 'q', '2026-10-11T08:03:00Z')]),
      thread('x', [note('li', 'about @joaolima', '2026-10-11T08:04:00Z')]),
    ],
    opts,
  )
  expect(a.items.map((i) => (i.kind === 'thread' ? i.you : null))).toEqual([
    'mentioned',
    'replied',
    'started',
    null,
  ])
})

test('a bot thread you joined is yours, not a bot’s', () => {
  const bot = { username: 'ci-bot', name: 'CI', avatarUrl: null, bot: true }
  const a = buildActivity(
    [
      thread('b', [
        note('ci-bot', 'coverage dropped', '2026-10-11T08:00:00Z', { author: bot }),
        note('joao', 'fixing', '2026-10-11T08:05:00Z'),
      ]),
    ],
    opts,
  )
  expect(a.items).toHaveLength(1)
  expect(a.items[0]).toMatchObject({ category: 'unresolved', you: 'replied' })
})

test('a thread maps to the review view’s discussion shape, without system notes', () => {
  const d = thread('abc', [
    note('li', 'why?', '2026-10-11T08:00:00Z', {
      position: { filePath: 'src/a.py', newLine: 4, oldLine: null, baseSha: null, headSha: null },
    }),
    note('ana', 'changed the title', '2026-10-11T08:01:00Z', { system: true, icon: 'pencil' }),
  ])
  expect(toThreadDiscussion(d)).toEqual({
    id: 'abc',
    individual_note: false,
    notes: [
      expect.objectContaining({
        body: 'why?',
        author: { name: 'li', username: 'li', avatar_url: undefined },
        created_at: '2026-10-11T08:00:00Z',
        position: { new_path: 'src/a.py', old_path: 'src/a.py', new_line: 4, old_line: null },
        resolvable: true,
        resolved: false,
      }),
    ],
  })
})

test('a thread asked for by id stays shown whatever the filters say', () => {
  const a = buildActivity(
    [thread('done', [note('li', 'ok', '2026-10-11T08:00:00Z')], { resolved: true })],
    { ...opts, show: new Set(['done']) },
  )
  expect(ids(a.items)).toEqual(['done'])
  expect(a.hidden.resolved).toBe(0)
})

test('the same overview gives the same thread objects, so open threads keep their state', () => {
  const discussions = [thread('t', [note('li', 'q', '2026-10-11T08:00:00Z')])]
  const one = buildActivity(discussions, opts).items[0]
  const two = buildActivity(discussions, { ...opts, filters: { ...DEFAULT_FILTERS } }).items[0]
  expect(one.kind === 'thread' && two.kind === 'thread' && one.discussion === two.discussion).toBe(true)
  expect(one.kind === 'thread' && toThreadDiscussion(one.discussion)).toBe(
    two.kind === 'thread' && toThreadDiscussion(two.discussion),
  )
})

test('the thread waiting on you: the newest open one that involves you and is not answered by you', () => {
  const discussions = [
    thread('old', [note('li', 'hey @joao', '2026-10-11T08:00:00Z')]),
    thread('answered', [note('li', '@joao?', '2026-10-11T09:00:00Z'), note('joao', 'yes', '2026-10-11T09:05:00Z')]),
    thread('new', [note('joao', 'q', '2026-10-11T07:00:00Z'), note('ana', 'a', '2026-10-11T10:00:00Z')]),
    thread('closed', [note('li', '@joao', '2026-10-11T11:00:00Z')], { resolved: true }),
    thread('not-mine', [note('li', 'x', '2026-10-11T12:00:00Z')]),
  ]
  expect(waitingOnYou(discussions, 'joao')).toBe('new')
  expect(waitingOnYou([], 'joao')).toBeNull()
})
