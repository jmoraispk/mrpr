import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { server } from '../test/server'
import { GitLabClient } from './client'
import {
  approve,
  commitsSince,
  diffsSince,
  postComment,
  rebase,
  unapprove,
} from './reviewActions'
import { withSignature } from './signature'

const API = 'https://gitlab.example.com/api/v4'
const MR = `${API}/projects/g%2Fp/merge_requests/1`
const client = () => new GitLabClient(API, 'secret')

test('the signature is added once', () => {
  expect(withSignature('Looks good')).toBe('Looks good\n\n*— via Mr. PR*')
  expect(withSignature(withSignature('Looks good'))).toBe('Looks good\n\n*— via Mr. PR*')
})

test('approve and unapprove call GitLab', async () => {
  const calls: string[] = []
  server.use(
    http.post(`${MR}/approve`, () => {
      calls.push('approve')
      return HttpResponse.json({})
    }),
    http.post(`${MR}/unapprove`, () => {
      calls.push('unapprove')
      return HttpResponse.json({})
    }),
  )
  await approve(client(), 'g/p', 1)
  await unapprove(client(), 'g/p', 1)
  expect(calls).toEqual(['approve', 'unapprove'])
})

test('an MR-level comment is a new discussion', async () => {
  let body: unknown
  server.use(
    http.post(`${MR}/discussions`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 'd', notes: [] })
    }),
  )
  await postComment(client(), 'g/p', 1, 'hello')
  expect(body).toEqual({ body: 'hello' })
})

test('the diff since a commit comes from compare', async () => {
  server.use(
    http.get(`${API}/projects/g%2Fp/repository/compare`, ({ request }) => {
      const url = new URL(request.url)
      expect([url.searchParams.get('from'), url.searchParams.get('to')]).toEqual(['old', 'new'])
      return HttpResponse.json({
        diffs: [{ old_path: 'a', new_path: 'a', diff: '@@ -1 +1 @@\n-a\n+b' }],
      })
    }),
  )
  await expect(diffsSince(client(), 'g/p', 'old', 'new')).resolves.toEqual([
    {
      old_path: 'a',
      new_path: 'a',
      diff: '@@ -1 +1 @@\n-a\n+b',
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      collapsed: false,
      too_large: false,
    },
  ])
})

test('commits since a sha are counted, newest first', async () => {
  server.use(
    http.get(`${MR}/commits`, () =>
      HttpResponse.json([{ id: 'c3' }, { id: 'c2' }, { id: 'c1' }]),
    ),
  )
  await expect(commitsSince(client(), 'g/p', 1, 'c1')).resolves.toBe(2)
  await expect(commitsSince(client(), 'g/p', 1, 'c3')).resolves.toBe(0)
})

test('a force-pushed head still counts as new', async () => {
  server.use(http.get(`${MR}/commits`, () => HttpResponse.json([{ id: 'x2' }, { id: 'x1' }])))
  await expect(commitsSince(client(), 'g/p', 1, 'gone')).resolves.toBe(2)
})

test('rebase asks GitLab to rebase the source branch', async () => {
  let method = ''
  server.use(
    http.put(`${MR}/rebase`, ({ request }) => {
      method = request.method
      return HttpResponse.json({ rebase_in_progress: true })
    }),
  )
  await rebase(client(), 'g/p', 1)
  expect(method).toBe('PUT')
})
