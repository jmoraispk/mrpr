import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test } from 'vitest'

import { installTestPlatform } from '../test/fakePlatform'
import { createFakeGitLab, fakeMergeRequest, fakeNote } from '../test/fakeGitLab'
import { server } from '../test/server'

let fake = installTestPlatform()

const { saveHost } = await import('./hosts')
const { forgetMergedMrs, handleMessage, MERGED_TIMEOUT, scrubToken } = await import('./router')

// The msw server lifecycle (listen/resetHandlers/close) is owned by
// src/test/setup.ts. Standing up a second setupServer() here would make every
// request resolver run twice.
const BASE = 'https://gitlab.example.com/api/v4'
const TARGET = { hostId: 'gitlab.example.com', project: 'p', iid: 1 }

beforeEach(async () => {
  fake = installTestPlatform()
  forgetMergedMrs()
  await saveHost(
    {
      id: 'gitlab.example.com',
      host: 'gitlab.example.com',
      apiBase: BASE,
      userId: 7,
      username: 'joao',
    },
    'secret-token',
  )
})

test('dispatches a review op', async () => {
  server.use(
    http.get(`${BASE}/projects/p/merge_requests/1`, () =>
      HttpResponse.json({ iid: 1, title: 'x' }),
    ),
  )
  await expect(
    handleMessage({ kind: 'mrpr/review', op: 'getMergeRequest', target: TARGET }),
  ).resolves.toMatchObject({ ok: true, data: { iid: 1 } })
})

test('getConfig is answered from the stored host', async () => {
  await expect(
    handleMessage({ kind: 'mrpr/review', op: 'getConfig', target: TARGET }),
  ).resolves.toEqual({
    ok: true,
    data: { host: 'gitlab.example.com', project: 'p', mr_iid: 1 },
  })
})

test('an unknown host is a structured error, not a throw', async () => {
  await expect(
    handleMessage({
      kind: 'mrpr/review',
      op: 'getDiffs',
      target: { ...TARGET, hostId: 'nope' },
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'host_not_configured', status: 400 },
  })
})

// Without the permission check the browser blocks the fetch, the client cannot
// tell that apart from an outage, and the user is told to wait for GitLab to
// recover when the real fix is one permission grant.
test('a GitLab error becomes the shared envelope', async () => {
  server.use(
    http.get(`${BASE}/projects/p/merge_requests/1`, () =>
      HttpResponse.json({ message: 'nope' }, { status: 401 }),
    ),
  )
  await expect(
    handleMessage({ kind: 'mrpr/review', op: 'getMergeRequest', target: TARGET }),
  ).resolves.toEqual({
    ok: false,
    error: {
      code: 'gitlab_authentication_failed',
      message: 'nope',
      status: 401,
    },
  })
})

test('the token is scrubbed out of error text', async () => {
  server.use(
    http.get(`${BASE}/projects/p/merge_requests/1`, () =>
      HttpResponse.json(
        { message: 'bad header PRIVATE-TOKEN=secret-token' },
        { status: 400 },
      ),
    ),
  )
  const response = await handleMessage({
    kind: 'mrpr/review',
    op: 'getMergeRequest',
    target: TARGET,
  })
  expect(JSON.stringify(response)).not.toContain('secret-token')
  expect(JSON.stringify(response)).toContain('[redacted]')
})

test('scrubToken is a no-op without a token', () => {
  expect(scrubToken('hello', null)).toBe('hello')
  expect(scrubToken('hello', '')).toBe('hello')
})

test('listHosts never returns a token', async () => {
  const response = await handleMessage({ kind: 'mrpr/hub', op: 'listHosts' })
  // Pinned to a real success: an error envelope would satisfy the absence
  // assertion below on its own.
  expect(response).toMatchObject({
    ok: true,
    data: [{ id: 'gitlab.example.com' }],
  })
  expect(JSON.stringify(response)).not.toContain('secret-token')
})

test('a signed-in host is fetched', async () => {
  server.use(http.get(`${BASE}/merge_requests`, () => HttpResponse.json([])))
  await expect(
    handleMessage({ kind: 'mrpr/hub', op: 'listMergeRequests' }),
  ).resolves.toMatchObject({
    ok: true,
    data: [{ hostId: 'gitlab.example.com', reviewing: { items: [] } }],
  })
})

test('an unknown op is rejected', async () => {
  await expect(
    handleMessage({
      kind: 'mrpr/review',
      op: 'nope' as never,
      target: TARGET,
    }),
  ).resolves.toMatchObject({ ok: false, error: { code: 'unknown_op' } })
})

function inboxItem(n: number, read = false) {
  return {
    id: `gitlab.example.com:${n}`,
    kind: 'comment',
    hostId: 'gitlab.example.com',
    mrId: 1,
    project: 'p',
    iid: 1,
    mrTitle: 'x',
    discussionId: 'd',
    noteId: n,
    author: null,
    excerpt: '',
    createdAt: new Date(Date.UTC(2026, 8, 24, 12, n)).toISOString(),
    webUrl: '',
    read,
  }
}

async function storeInbox(items: ReturnType<typeof inboxItem>[]) {
  await fake.store.set({ inbox: {
    hosts: {
      'gitlab.example.com': {
        lastPollAt: '2026-09-24T12:00:00.000Z',
        lastEventsAt: null,
        mrs: {},
        items,
        error: null,
      },
    },
  } })
}

test('listInbox answers from storage and never carries a token', async () => {
  await storeInbox([inboxItem(2), inboxItem(1, true)])

  const response = await handleMessage({ kind: 'mrpr/hub', op: 'listInbox' })

  expect(response).toMatchObject({
    ok: true,
    data: { unread: 1, items: [{ noteId: 2 }, { noteId: 1 }] },
  })
  expect(JSON.stringify(response)).not.toContain('secret-token')
})

test('markRead marks the named items and updates the badge', async () => {
  await storeInbox([inboxItem(2), inboxItem(1)])

  await expect(
    handleMessage({
      kind: 'mrpr/hub',
      op: 'markRead',
      payload: { ids: ['gitlab.example.com:2'] },
    }),
  ).resolves.toEqual({ ok: true, data: null })

  expect(fake.showUnread).toHaveBeenLastCalledWith(1)
})

test('markAllRead clears the badge', async () => {
  await storeInbox([inboxItem(2), inboxItem(1)])

  await handleMessage({ kind: 'mrpr/hub', op: 'markAllRead' })

  expect(fake.showUnread).toHaveBeenLastCalledWith(0)
})

test('pollNow polls and returns the fresh inbox', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(1, {
      discussions: [
        {
          id: 'd1',
          notes: [fakeNote(11, 'ana', 'Why?', new Date().toISOString())],
        },
      ],
    }),
  )
  gitlab.lists.authored.push(1)

  const response = await handleMessage({ kind: 'mrpr/hub', op: 'pollNow' })

  expect(response).toMatchObject({
    ok: true,
    data: { unread: 1, items: [{ id: 'gitlab.example.com:11' }] },
  })
})

test('listQueue returns each host’s MRs with facts, or its error', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(1))
  gitlab.lists.authored.push(1)

  const response = await handleMessage({ kind: 'mrpr/hub', op: 'listQueue' })

  expect(response).toMatchObject({
    ok: true,
    data: [
      {
        hostId: 'gitlab.example.com',
        username: 'joao',
        error: null,
        mrs: [{ id: 1, roles: ['author'] }],
      },
    ],
  })
})

test('every comment Mr. PR posts is signed once', async () => {
  const bodies: string[] = []
  server.use(
    http.post(`${BASE}/projects/p/merge_requests/1/discussions`, async ({ request }) => {
      bodies.push(((await request.json()) as { body: string }).body)
      return HttpResponse.json({ id: 'd', notes: [] })
    }),
    http.post(
      `${BASE}/projects/p/merge_requests/1/discussions/d/notes`,
      async ({ request }) => {
        bodies.push(((await request.json()) as { body: string }).body)
        return HttpResponse.json({ id: 2, body: '' })
      },
    ),
  )
  await handleMessage({
    kind: 'mrpr/review',
    op: 'postComment',
    target: TARGET,
    payload: { body: '@ana Requesting changes: x' },
  })
  await handleMessage({
    kind: 'mrpr/review',
    op: 'replyToDiscussion',
    target: TARGET,
    payload: { discussionId: 'd', body: 'ok' },
  })
  expect(bodies).toEqual(['@ana Requesting changes: x\n\n*— via Mr. PR*', 'ok\n\n*— via Mr. PR*'])
})

test('getOverview returns the MR overview for the target', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(1, { project: 'p' }))
  const response = await handleMessage({
    kind: 'mrpr/review',
    op: 'getOverview',
    target: TARGET,
  })
  expect(response).toMatchObject({ ok: true, data: { iid: 1, title: 'MR 1' } })
})

test('listQueue adds merged MRs; an MR in both lists is one row, merged', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(9))
  gitlab.add(fakeMergeRequest(10, { state: 'merged' }))
  gitlab.lists.reviewing.push(9)
  // Merged between the two reads: the open list still has 9, the merged list has it too.
  gitlab.mergedOverride = [9, 10]

  const response = await handleMessage({ kind: 'mrpr/hub', op: 'listQueue' })

  const [host] = (response as { data: { mrs: { id: number; state: string }[]; error: string | null }[] }).data
  expect(host.error).toBeNull()
  expect(host.mrs.map((mr) => [mr.id, mr.state])).toEqual([[9, 'merged'], [10, 'merged']])
})

test('a failing merged query leaves the open MRs', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(9))
  gitlab.lists.reviewing.push(9)
  gitlab.failMerged = true

  const response = await handleMessage({ kind: 'mrpr/hub', op: 'listQueue' })

  const [host] = (response as { data: { mrs: { id: number }[]; error: string | null }[] }).data
  expect(host.error).toBeNull()
  expect(host.mrs.map((mr) => mr.id)).toEqual([9])
})

test('a merged query that fails after one that worked keeps the merged MRs it had', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(9))
  gitlab.add(fakeMergeRequest(10, { state: 'merged' }))
  gitlab.lists.reviewing.push(9, 10)
  await handleMessage({ kind: 'mrpr/hub', op: 'listQueue' })
  gitlab.failMerged = true

  const response = await handleMessage({ kind: 'mrpr/hub', op: 'listQueue' })

  const [host] = (response as { data: { mrs: { id: number }[] }[] }).data
  expect(host.mrs.map((mr) => mr.id)).toEqual([9, 10])
})

test('a slow merged query does not hold up the open MRs', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(9))
  gitlab.lists.reviewing.push(9)
  gitlab.mergedDelay = 2_000
  const before = MERGED_TIMEOUT.ms
  MERGED_TIMEOUT.ms = 50
  try {
    const started = Date.now()
    const response = await handleMessage({ kind: 'mrpr/hub', op: 'listQueue' })
    expect(Date.now() - started).toBeLessThan(1_500)
    const [host] = (response as { data: { mrs: { id: number }[]; error: string | null }[] }).data
    expect(host.error).toBeNull()
    expect(host.mrs.map((mr) => mr.id)).toEqual([9])
  } finally {
    MERGED_TIMEOUT.ms = before
  }
})
