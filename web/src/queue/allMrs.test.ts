import { expect, test } from 'vitest'

import { reposToList } from './allMrs'
import type { QueueRow } from './model'

test('repositories to list: most recently updated first, 20 per host at most, muted ones left out', () => {
  const rows = Array.from({ length: 25 }, (_, n) => ({
    hostId: 'h',
    project: `g/r${n}`,
    updatedAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
  })) as QueueRow[]
  const repos = reposToList(rows, { 'repo:h:g/r24': 'g/r24' })
  expect(repos.h).toHaveLength(20)
  expect(repos.h[0]).toBe('g/r23')
  expect(repos.h).not.toContain('g/r24')
})

test('a repository appears once, by its most recent row', () => {
  const rows = [
    { hostId: 'h', project: 'g/a', updatedAt: '2026-10-01T00:00:00Z' },
    { hostId: 'h', project: 'g/b', updatedAt: '2026-10-02T00:00:00Z' },
    { hostId: 'h', project: 'g/a', updatedAt: '2026-10-03T00:00:00Z' },
  ] as QueueRow[]
  expect(reposToList(rows, {})).toEqual({ h: ['g/a', 'g/b'] })
})
