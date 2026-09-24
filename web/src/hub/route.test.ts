import { expect, test, vi } from 'vitest'

import { createFakeBrowser } from '../test/fakeBrowser'
import { buildReviewHash, parseRoute } from './route'

// `mrUrl` reuses `hostIdFor` from `../extension/hosts`, which imports
// `webextension-polyfill` at module scope. See src/test/fakeBrowser.ts for why
// the mock must be literal here and the import dynamic.
const fake = createFakeBrowser()
vi.mock('webextension-polyfill', () => ({ default: fake }))

const { parseMergeRequestUrl } = await import('./mrUrl')

const hosts = [
  {
    id: 'gitlab.example.com',
    host: 'gitlab.example.com',
    apiBase: 'https://gitlab.example.com/api/v4',
    userId: 7,
    username: 'joao',
  },
]

const TARGET = { hostId: 'gitlab.example.com', project: 'group/sub/p', iid: 42 }

test('parses a merge request URL for a configured host', () => {
  expect(
    parseMergeRequestUrl(
      'https://gitlab.example.com/group/sub/p/-/merge_requests/42',
      hosts,
    ),
  ).toEqual(TARGET)
})

test('tolerates a trailing slash and a diffs suffix', () => {
  for (const suffix of ['/', '/diffs', '/diffs?commit_id=abc', '#note_1']) {
    expect(
      parseMergeRequestUrl(
        `https://gitlab.example.com/group/sub/p/-/merge_requests/42${suffix}`,
        hosts,
      ),
    ).toEqual(TARGET)
  }
})

test('strips a .git suffix from the project path', () => {
  expect(
    parseMergeRequestUrl(
      'https://gitlab.example.com/group/p.git/-/merge_requests/1',
      hosts,
    ),
  ).toMatchObject({ project: 'group/p' })
})

test('rejects an unconfigured host', () => {
  expect(
    parseMergeRequestUrl(
      'https://gitlab.other.com/group/p/-/merge_requests/42',
      hosts,
    ),
  ).toBeNull()
})

test('rejects a non-merge-request URL', () => {
  for (const url of [
    'https://gitlab.example.com/group/p/-/issues/42',
    'https://gitlab.example.com/group/p',
    'not a url',
    // Mirrors the `scheme not in {"http", "https"}` guard in config.py: the
    // host and path both match, only the scheme disqualifies it.
    'ftp://gitlab.example.com/group/p/-/merge_requests/42',
  ]) {
    expect(parseMergeRequestUrl(url, hosts)).toBeNull()
  }
})

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
