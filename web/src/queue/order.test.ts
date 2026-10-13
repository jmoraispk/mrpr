import { expect, test } from 'vitest'

import type { QueueMr } from '../gitlab/queueFacts'
import type { QueueRow } from './model'
import { filterRows, groupRows, repoGroupId, sortRows, tagChips, type ListFilters, type ListOrder } from './order'
import type { Project } from './projects'

function facts(over: Partial<QueueMr> = {}): QueueMr {
  return {
    additions: 10,
    deletions: 0,
    createdAt: '2026-10-01T00:00:00Z',
    draft: false,
    labels: [],
    author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
    ...over,
  } as QueueMr
}

function row(n: number, over: Partial<QueueRow> = {}): QueueRow {
  return {
    key: `h:${n}`,
    hostId: 'h',
    host: 'h',
    mr: facts(),
    project: 'g/a',
    iid: n,
    title: `MR ${n}`,
    webUrl: '',
    updatedAt: '2026-10-11T10:00:00Z',
    tags: [],
    attention: 'done',
    folded: false,
    minutes: 1,
    score: 0,
    items: [],
    snoozed: false,
    ...over,
  } as QueueRow
}

const iids = (rows: QueueRow[]) => rows.map((r) => r.iid)
const DEFAULT: ListOrder = { tags: [], sortBy: 'waiting' }

test('the default order: what needs you, then returned, waiting, done; then score; then newest', () => {
  const rows = [
    row(1, { attention: 'done', score: 50 }),
    row(2, { attention: 'waiting' }),
    row(3, { attention: 'needs-you', score: 1 }),
    row(4, { attention: 'needs-you', score: 9 }),
    row(5, { attention: 'returned' }),
    row(6, { attention: 'needs-you', score: 1, updatedAt: '2026-10-11T11:00:00Z' }),
  ]
  expect(iids(sortRows(rows, DEFAULT))).toEqual([4, 6, 3, 5, 2, 1])
})

test('recently updated, oldest first, smallest first', () => {
  const rows = [
    row(1, { updatedAt: '2026-10-11T09:00:00Z', mr: facts({ createdAt: '2026-10-03T00:00:00Z', additions: 50 }) }),
    row(2, { updatedAt: '2026-10-11T11:00:00Z', mr: facts({ createdAt: '2026-10-02T00:00:00Z', additions: 5 }) }),
    // Without facts: its update time stands in for creation, and it is the largest.
    row(3, { updatedAt: '2026-10-01T00:00:00Z', mr: null }),
  ]
  expect(iids(sortRows(rows, { tags: [], sortBy: 'updated' }))).toEqual([2, 1, 3])
  expect(iids(sortRows(rows, { tags: [], sortBy: 'oldest' }))).toEqual([3, 2, 1])
  expect(iids(sortRows(rows, { tags: [], sortBy: 'smallest' }))).toEqual([2, 1, 3])
})

test('chosen tags come first, in your order; the sort settles the rest', () => {
  const rows = [
    row(1, { attention: 'needs-you', score: 9 }),
    row(2, { tags: [{ kind: 'draft' }] }),
    row(3, { tags: [{ kind: 'quick-win', minutes: 1 }], attention: 'needs-you' }),
    row(4, { tags: [{ kind: 'draft' }, { kind: 'quick-win', minutes: 1 }], attention: 'needs-you', score: 5 }),
  ]
  expect(iids(sortRows(rows, { tags: ['draft'], sortBy: 'waiting' }))).toEqual([4, 2, 1, 3])
  expect(iids(sortRows(rows, { tags: ['quick-win', 'draft'], sortBy: 'waiting' }))).toEqual([
    4, 3, 2, 1,
  ])
})

const NONE: ListFilters = { needsMeOnly: false, hideDrafts: false, showDone: false }

test('done rows hide unless Show done; snoozed and folded rows never list', () => {
  const rows = [
    row(1, { attention: 'needs-you' }),
    row(2, { attention: 'done' }),
    row(3, { attention: 'needs-you', snoozed: true }),
    row(4, { attention: 'needs-you', folded: true }),
  ]
  expect(iids(filterRows(rows, NONE, ''))).toEqual([1])
  expect(iids(filterRows(rows, { ...NONE, showDone: true }, ''))).toEqual([1, 2])
})

test('Needs me only keeps what needs you and what came back; Hide drafts hides drafts', () => {
  const rows = [
    row(1, { attention: 'needs-you' }),
    row(2, { attention: 'returned' }),
    row(3, { attention: 'waiting' }),
    row(4, { attention: 'needs-you', mr: facts({ draft: true }) }),
  ]
  expect(iids(filterRows(rows, { ...NONE, needsMeOnly: true }, ''))).toEqual([1, 2, 4])
  expect(iids(filterRows(rows, { ...NONE, hideDrafts: true }, ''))).toEqual([1, 2, 3])
})

test('search matches title, !iid, author, repository and tag text, in any case', () => {
  const rows = [
    row(1, { attention: 'needs-you', title: 'Retry budget' }),
    row(22, { attention: 'needs-you', mr: facts({ author: { username: 'li', name: 'Li Wei', avatarUrl: null, bot: false } }) }),
    row(3, { attention: 'needs-you', project: 'g/payments' }),
    row(4, { attention: 'needs-you', tags: [{ kind: 'blocking', people: 2 }] }),
  ]
  expect(iids(filterRows(rows, NONE, 'RETRY'))).toEqual([1])
  expect(iids(filterRows(rows, NONE, '!22'))).toEqual([22])
  expect(iids(filterRows(rows, NONE, 'li wei'))).toEqual([22])
  expect(iids(filterRows(rows, NONE, 'payments'))).toEqual([3])
  expect(iids(filterRows(rows, NONE, 'blocking 2'))).toEqual([4])
  expect(iids(filterRows(rows, NONE, '  '))).toEqual([1, 22, 3, 4])
})

const PROJECTS: Project[] = [
  { id: 'web', name: 'Web', color: '#1E4FD8', rules: { repositories: ['g/web'], labels: [] }, pinned: [] },
  { id: 'empty', name: 'Empty', color: '#C2410C', rules: { repositories: ['g/none'], labels: [] }, pinned: [] },
]

test('your projects first, in your order; then one group per repository, by its first row', () => {
  const rows = [
    row(1, { project: 'g/zeta', attention: 'needs-you' }),
    row(2, { project: 'g/web', attention: 'needs-you' }),
    row(3, { project: 'g/alpha' }),
    row(4, { project: 'g/zeta' }),
    row(5, { project: 'g/web' }),
  ]
  const groups = groupRows(rows, PROJECTS)
  expect(groups.map((g) => [g.id, g.name, iids(g.rows), g.needsYou])).toEqual([
    ['web', 'Web', [2, 5], 1],
    ['repo:h:g/zeta', 'g/zeta', [1, 4], 1],
    ['repo:h:g/alpha', 'g/alpha', [3], 0],
  ])
  expect(groups[0]).toMatchObject({ projectId: 'web', color: '#1E4FD8' })
  expect(groups[1]).toMatchObject({ projectId: null, color: null })
  expect(repoGroupId(rows[0])).toBe('repo:h:g/zeta')
})

test('chips: chosen tags first with their place, then the rest by priority, with counts', () => {
  const rows = [
    row(1, { tags: [{ kind: 'draft' }, { kind: 'needs-review' }] }),
    row(2, { tags: [{ kind: 'needs-review' }, { kind: 'quick-win', minutes: 1 }] }),
  ]
  expect(tagChips(rows, ['draft', 'returned'])).toEqual([
    { kind: 'draft', count: 1, position: 1 },
    // Chosen but on no row: still shown, so it can be taken off.
    { kind: 'returned', count: 0, position: 2 },
    { kind: 'needs-review', count: 2, position: null },
    { kind: 'quick-win', count: 1, position: null },
  ])
})
