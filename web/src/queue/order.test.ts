import { expect, test } from 'vitest'

import type { QueueMr } from '../gitlab/queueFacts'
import type { QueueRow } from './model'
import { directionLabel, filterRows, groupRows, repoGroupId, sortRows, type ListFilters, type ListOrder } from './order'
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
const at = (iso: string) => ({ updatedAt: iso })
const CHANGED: ListOrder = { sortBy: 'changed', descending: true }

test('Last changed: newest first, or oldest first when flipped; ties by key', () => {
  const rows = [
    row(1, at('2026-10-11T08:00:00Z')),
    row(2, at('2026-10-11T12:00:00Z')),
    row(3, at('2026-10-11T10:00:00Z')),
    row(4, at('2026-10-11T10:00:00Z')),
  ]
  expect(iids(sortRows(rows, CHANGED))).toEqual([2, 3, 4, 1])
  expect(iids(sortRows(rows, { ...CHANGED, descending: false }))).toEqual([1, 3, 4, 2])
})

test('Age: oldest MR first by default; an MR without a created date uses its last change', () => {
  const rows = [
    row(1, { mr: facts({ createdAt: '2026-10-05T00:00:00Z' }) }),
    row(2, { mr: facts({ createdAt: '2026-10-01T00:00:00Z' }) }),
    row(3, { mr: null, updatedAt: '2026-10-03T00:00:00Z' }),
  ]
  expect(iids(sortRows(rows, { sortBy: 'age', descending: false }))).toEqual([2, 3, 1])
  expect(iids(sortRows(rows, { sortBy: 'age', descending: true }))).toEqual([1, 3, 2])
})

test('Size: smallest first by default; rows without a size go last either way', () => {
  const rows = [
    row(1, { mr: facts({ additions: 50, deletions: 0 }) }),
    row(2, { mr: null }),
    row(3, { mr: facts({ additions: 3, deletions: 2 }) }),
  ]
  expect(iids(sortRows(rows, { sortBy: 'size', descending: false }))).toEqual([3, 1, 2])
  expect(iids(sortRows(rows, { sortBy: 'size', descending: true }))).toEqual([1, 3, 2])
})

test('the direction button says which way the list runs', () => {
  expect(directionLabel({ sortBy: 'changed', descending: true })).toBe('Newest first')
  expect(directionLabel({ sortBy: 'changed', descending: false })).toBe('Oldest first')
  expect(directionLabel({ sortBy: 'age', descending: false })).toBe('Oldest first')
  expect(directionLabel({ sortBy: 'size', descending: false })).toBe('Smallest first')
  expect(directionLabel({ sortBy: 'size', descending: true })).toBe('Largest first')
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

test('search matches title, !iid, author and repository, in any case', () => {
  const rows = [
    row(1, { attention: 'needs-you', title: 'Retry budget' }),
    row(22, { attention: 'needs-you', mr: facts({ author: { username: 'li', name: 'Li Wei', avatarUrl: null, bot: false } }) }),
    row(3, { attention: 'needs-you', project: 'g/payments' }),
  ]
  expect(iids(filterRows(rows, NONE, 'RETRY'))).toEqual([1])
  expect(iids(filterRows(rows, NONE, '!22'))).toEqual([22])
  expect(iids(filterRows(rows, NONE, 'li wei'))).toEqual([22])
  expect(iids(filterRows(rows, NONE, 'payments'))).toEqual([3])
  expect(iids(filterRows(rows, NONE, '  '))).toEqual([1, 22, 3])
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
  expect(groups[1]).toMatchObject({ projectId: null, color: null, repo: 'g/zeta' })
  expect(groups[0]).toMatchObject({ repo: null })
  expect(repoGroupId(rows[0])).toBe('repo:h:g/zeta')
})

test('the snoozed view keeps snoozed and done rows, still never folded ones', () => {
  const rows = [
    row(1, { attention: 'needs-you', snoozed: true }),
    row(2, { attention: 'done', snoozed: true }),
    row(3, { attention: 'needs-you', folded: true, snoozed: true }),
  ]
  expect(iids(filterRows(rows, NONE, '', 'snoozed'))).toEqual([1, 2])
  expect(iids(filterRows(rows, NONE, ''))).toEqual([])
})
