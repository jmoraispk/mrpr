import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { server } from '../test/server'
import { GitLabClient } from './client'
import { getDiffs, getMergeRequest, mergeRequestPath } from './diffs'

// The msw server lifecycle (listen/resetHandlers/close) is owned by
// src/test/setup.ts. Standing up a second setupServer() here would make every
// request resolver run twice.
const BASE = 'https://gitlab.example.com/api/v4'
const MR = `${BASE}/projects/platform%2Fmrpr/merge_requests/42`
const client = () => new GitLabClient(BASE, 'token')

const FILE = {
  old_path: 'src/parser.py',
  new_path: 'src/parser.py',
  diff: '@@ -1 +1 @@\n-old\n+new',
}

test('encodes the project path', () => {
  expect(mergeRequestPath('platform/mrpr', 42)).toBe(
    '/projects/platform%2Fmrpr/merge_requests/42',
  )
})

test('reads the merge request', async () => {
  server.use(http.get(MR, () => HttpResponse.json({ iid: 42 })))
  await expect(
    getMergeRequest(client(), 'platform/mrpr', 42),
  ).resolves.toMatchObject({ iid: 42 })
})

test('reads diffs from the paginated endpoint', async () => {
  server.use(
    http.get(`${MR}/diffs`, () =>
      HttpResponse.json([FILE], { headers: { 'x-next-page': '' } }),
    ),
  )
  const files = await getDiffs(client(), 'platform/mrpr', 42)
  expect(files).toHaveLength(1)
  expect(files[0]).toMatchObject({ new_path: 'src/parser.py', new_file: false })
})

test('falls back to changes when diffs 404s', async () => {
  server.use(
    http.get(`${MR}/diffs`, () => HttpResponse.json({}, { status: 404 })),
    http.get(`${MR}/changes`, () =>
      HttpResponse.json({ overflow: false, changes: [FILE] }),
    ),
  )
  await expect(
    getDiffs(client(), 'platform/mrpr', 42),
  ).resolves.toHaveLength(1)
})

test('retries changes with raw diffs on overflow', async () => {
  const seen: string[] = []
  server.use(
    http.get(`${MR}/diffs`, () => HttpResponse.json({}, { status: 500 })),
    http.get(`${MR}/changes`, ({ request }) => {
      const raw = new URL(request.url).searchParams.get('access_raw_diffs')
      seen.push(raw ?? 'absent')
      return HttpResponse.json(
        raw === 'true'
          ? { overflow: false, changes: [FILE] }
          : { overflow: true, changes: [] },
      )
    }),
  )
  await expect(
    getDiffs(client(), 'platform/mrpr', 42),
  ).resolves.toHaveLength(1)
  expect(seen).toEqual(['absent', 'true'])
})

test('throws diff_truncated when overflow persists', async () => {
  server.use(
    http.get(`${MR}/diffs`, () => HttpResponse.json({}, { status: 500 })),
    http.get(`${MR}/changes`, () =>
      HttpResponse.json({ overflow: true, changes: [] }),
    ),
  )
  await expect(
    getDiffs(client(), 'platform/mrpr', 42),
  ).rejects.toMatchObject({ code: 'diff_truncated', status: 422 })
})

test('refetches raw diffs when pagination truncates', async () => {
  const empty = { old_path: 'b.py', new_path: 'b.py', diff: '' }
  const filled = { old_path: 'b.py', new_path: 'b.py', diff: '@@ -1 +1 @@\n-c\n+d' }
  const seen: string[] = []
  server.use(
    http.get(`${MR}/diffs`, () =>
      HttpResponse.json([FILE, empty], { headers: { 'x-next-page': '' } }),
    ),
    http.get(`${MR}/changes`, ({ request }) => {
      seen.push(new URL(request.url).searchParams.get('access_raw_diffs') ?? 'absent')
      return HttpResponse.json({ overflow: false, changes: [FILE, filled] })
    }),
  )

  const files = await getDiffs(client(), 'platform/mrpr', 42)
  expect(seen).toEqual(['true'])
  expect(files.map((file) => file.diff)).toEqual([
    '@@ -1 +1 @@\n-old\n+new',
    '@@ -1 +1 @@\n-c\n+d',
  ])
})

test('keeps paginated diffs when nothing is truncated', async () => {
  let changesCalled = false
  server.use(
    http.get(`${MR}/diffs`, () =>
      HttpResponse.json([FILE], { headers: { 'x-next-page': '' } }),
    ),
    http.get(`${MR}/changes`, () => {
      changesCalled = true
      return HttpResponse.json({ overflow: false, changes: [] })
    }),
  )

  await expect(
    getDiffs(client(), 'platform/mrpr', 42),
  ).resolves.toHaveLength(1)
  expect(changesCalled).toBe(false)
})

test('keeps paginated diffs when the raw refetch fails', async () => {
  const empty = { old_path: 'b.py', new_path: 'b.py', diff: '' }
  server.use(
    http.get(`${MR}/diffs`, () =>
      HttpResponse.json([FILE, empty], { headers: { 'x-next-page': '' } }),
    ),
    http.get(`${MR}/changes`, () => HttpResponse.json({}, { status: 403 })),
  )

  const files = await getDiffs(client(), 'platform/mrpr', 42)
  expect(files).toHaveLength(2)
  expect(files[1].diff).toBe('')
})

test('does not swallow a 403 from diffs', async () => {
  server.use(
    http.get(`${MR}/diffs`, () => HttpResponse.json({}, { status: 403 })),
  )
  await expect(
    getDiffs(client(), 'platform/mrpr', 42),
  ).rejects.toMatchObject({ code: 'gitlab_access_denied' })
})
