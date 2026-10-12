import { expect, test } from 'vitest'

import { listHash, parseSiteRoute, reviewHash } from './route'

const T = { hostId: 'gitlab.example.com', project: 'g/p', iid: 5 }

test('queue, buckets, projects, settings', () => {
  expect(parseSiteRoute('')).toEqual({ name: 'queue', bucket: null })
  expect(parseSiteRoute('#/bucket/waiting')).toEqual({ name: 'queue', bucket: 'waiting' })
  expect(parseSiteRoute('#/bucket/nonsense')).toEqual({ name: 'queue', bucket: null })
  expect(parseSiteRoute('#/project/abc')).toEqual({ name: 'project', id: 'abc' })
  expect(parseSiteRoute('#/settings')).toEqual({ name: 'settings' })
  expect(parseSiteRoute('#/snoozed')).toEqual({ name: 'snoozed' })
})


test('a review, its tab, a note in it, and full screen round-trip', () => {
  const base = { name: 'review', target: T, noteId: null, tab: 'overview', full: false }
  expect(parseSiteRoute(reviewHash(T))).toEqual(base)
  expect(reviewHash(T)).toBe('#/mr/gitlab.example.com/g%2Fp/5')
  expect(parseSiteRoute(reviewHash(T, { tab: 'changes' }))).toEqual({ ...base, tab: 'changes' })
  expect(parseSiteRoute(reviewHash(T, { tab: 'since', full: true }))).toEqual({
    ...base,
    tab: 'since',
    full: true,
  })
  expect(parseSiteRoute(reviewHash(T, { noteId: 9, tab: 'changes' }))).toEqual({
    ...base,
    noteId: 9,
    tab: 'changes',
  })
  // Links from before tabs existed still work.
  expect(parseSiteRoute('#/mr/gitlab.example.com/g%2Fp/5/since')).toEqual({ ...base, tab: 'since' })
})

test('every list has its own address', () => {
  expect(listHash({ name: 'queue', bucket: null })).toBe('#/')
  expect(listHash({ name: 'queue', bucket: 'waiting' })).toBe('#/bucket/waiting')
  expect(listHash({ name: 'project', id: 'abc' })).toBe('#/project/abc')
  expect(listHash({ name: 'snoozed' })).toBe('#/snoozed')
})
