import { expect, test } from 'vitest'

import { parseSiteRoute, reviewHash } from './route'

const T = { hostId: 'gitlab.example.com', project: 'g/p', iid: 5 }

test('queue, buckets, projects, settings', () => {
  expect(parseSiteRoute('')).toEqual({ name: 'queue', bucket: null })
  expect(parseSiteRoute('#/bucket/waiting')).toEqual({ name: 'queue', bucket: 'waiting' })
  expect(parseSiteRoute('#/bucket/nonsense')).toEqual({ name: 'queue', bucket: null })
  expect(parseSiteRoute('#/project/abc')).toEqual({ name: 'project', id: 'abc' })
  expect(parseSiteRoute('#/settings')).toEqual({ name: 'settings' })
  expect(parseSiteRoute('#/snoozed')).toEqual({ name: 'snoozed' })
})

test('a review, a note in it, and its since-last view round-trip', () => {
  expect(parseSiteRoute(reviewHash(T))).toEqual({
    name: 'review',
    target: T,
    noteId: null,
    since: false,
  })
  expect(parseSiteRoute(reviewHash(T, { since: true }))).toEqual({
    name: 'review',
    target: T,
    noteId: null,
    since: true,
  })
  expect(parseSiteRoute(reviewHash(T, { noteId: 9 }))).toEqual({
    name: 'review',
    target: T,
    noteId: 9,
    since: false,
  })
})
