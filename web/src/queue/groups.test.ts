import { expect, test } from 'vitest'

import { arrangeGroups, moveGroup, normalizeIds, normalizeNames, shiftGroup, withoutMuted } from './groups'
import type { QueueRow } from './model'
import type { RowGroup } from './order'
import type { Project } from './projects'

const group = (id: string, over: Partial<RowGroup> = {}): RowGroup => ({
  id,
  projectId: null,
  repo: id.replace('repo:h:', ''),
  name: id.replace('repo:h:', ''),
  color: null,
  rows: [],
  needsYou: 0,
  ...over,
})
const ids = (groups: RowGroup[]) => groups.map((g) => g.id)
const A = group('repo:h:g/a')
const B = group('repo:h:g/b')
const C = group('repo:h:g/c')

test('stored order first; unlisted groups after, in their own order; stale ids take no place', () => {
  expect(ids(arrangeGroups([A, B, C], ['repo:h:g/c', 'gone', 'repo:h:g/a'], {}))).toEqual([
    'repo:h:g/c',
    'repo:h:g/a',
    'repo:h:g/b',
  ])
  expect(ids(arrangeGroups([A, B, C], [], {}))).toEqual(['repo:h:g/a', 'repo:h:g/b', 'repo:h:g/c'])
})

test('a repository shows its display name; a project keeps its own', () => {
  const project = group('web', { projectId: 'web', repo: null, name: 'Web' })
  const named = arrangeGroups([A, project], [], { 'repo:h:g/a': 'Alpha', web: 'Ignored' })
  expect(named.map((g) => g.name)).toEqual(['Alpha', 'Web'])
  expect(named[0].repo).toBe('g/a')
})

test('moving: above or below a target; stored ids not listed now keep their places', () => {
  const listed = ['a', 'b', 'c']
  expect(moveGroup(listed, ['gone'], 'c', 'a', 'before')).toEqual(['gone', 'c', 'a', 'b'])
  expect(moveGroup(listed, [], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
  expect(moveGroup(listed, ['x'], 'a', 'a', 'after')).toEqual(['x'])
  expect(moveGroup(listed, ['x'], 'zzz', 'a', 'after')).toEqual(['x'])
  expect(shiftGroup(listed, [], 'b', -1)).toEqual(['b', 'a', 'c'])
  expect(shiftGroup(listed, [], 'b', 1)).toEqual(['a', 'c', 'b'])
  expect(shiftGroup(listed, ['x'], 'a', -1)).toEqual(['x'])
})

test('damaged stored values read as empty', () => {
  expect(normalizeIds('junk')).toEqual([])
  expect(normalizeIds(['a', 7, 'a', 'b'])).toEqual(['a', 'b'])
  expect(normalizeNames(['a'])).toEqual({})
  expect(normalizeNames({ a: ' Alpha ', b: '', c: 3 })).toEqual({ a: 'Alpha' })
})

test('a muted repository’s rows go, except those you put in a project', () => {
  const row = (iid: number, project: string) =>
    ({ key: `h:${iid}`, hostId: 'h', project, iid, tags: [] }) as unknown as QueueRow
  const projects: Project[] = [
    { id: 'p', name: 'P', color: '#000', rules: { repositories: [], labels: [] }, pinned: ['h:2'] },
  ]
  const rows = [row(1, 'g/a'), row(2, 'g/a'), row(3, 'g/b')]
  expect(withoutMuted(rows, { 'repo:h:g/a': 'g/a' }, projects).map((r) => r.iid)).toEqual([2, 3])
  expect(withoutMuted(rows, {}, projects)).toBe(rows)
})

test('a move in one tab, or in a narrowed list, leaves the groups you cannot see in their order', () => {
  // From others is arranged A, B, C, D; From me lists M and B; M moves below B.
  const stored = ['A', 'B', 'C', 'D']
  const next = moveGroup(['M', 'B'], stored, 'M', 'B', 'after')
  expect(next.filter((id) => id !== 'M')).toEqual(['A', 'B', 'C', 'D'])
  expect(next.indexOf('M')).toBe(next.indexOf('B') + 1)
  // A search shows only C and D; D moves above C. A and B stay first.
  expect(moveGroup(['C', 'D'], stored, 'D', 'C', 'before')).toEqual(['A', 'B', 'D', 'C'])
})
