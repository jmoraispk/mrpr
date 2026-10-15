import { expect, test } from 'vitest'

import { buildReviewHash, parseRoute } from './route'

const TARGET = { hostId: 'gitlab.example.com', project: 'group/sub/p', iid: 42 }

test('routes default to the inbox', () => {
  expect(parseRoute('')).toEqual({ name: 'inbox' })
  expect(parseRoute('#/')).toEqual({ name: 'inbox' })
  expect(parseRoute('#/settings')).toEqual({ name: 'settings' })
  expect(parseRoute('#/merge-requests')).toEqual({ name: 'mergeRequests' })
})

test('a review hash round-trips, slashes and all', () => {
  expect(parseRoute(buildReviewHash(TARGET))).toEqual({
    name: 'review',
    target: TARGET,
    noteId: null,
  })
})

test('a malformed review hash falls back to the inbox', () => {
  expect(parseRoute('#/mr/only-one-segment')).toEqual({ name: 'inbox' })
  expect(parseRoute('#/mr/h/p/not-a-number')).toEqual({ name: 'inbox' })
  expect(parseRoute('#/mr/h/p/0')).toEqual({ name: 'inbox' })
  // A hand-edited address bar can carry a bad percent sequence, which makes
  // decodeURIComponent throw. The hub must still render something.
  expect(parseRoute('#/mr/h/%E0%A4%A/5')).toEqual({ name: 'inbox' })
  expect(parseRoute('#/mr/h/p/5/note/abc')).toEqual({ name: 'inbox' })
  expect(parseRoute('#/mr/h/p/5/note/0')).toEqual({ name: 'inbox' })
  expect(parseRoute('#/mr/h/p/5/thread/7')).toEqual({ name: 'inbox' })
})

test('a review hash may name a note', () => {
  const hash = buildReviewHash(TARGET, 70867104)
  expect(hash).toBe('#/mr/gitlab.example.com/group%2Fsub%2Fp/42/note/70867104')
  expect(parseRoute(hash)).toEqual({
    name: 'review',
    target: TARGET,
    noteId: 70867104,
  })
  expect(buildReviewHash(TARGET, null)).toBe(buildReviewHash(TARGET))
})
