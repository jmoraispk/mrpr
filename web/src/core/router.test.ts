import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { createFakeBrowser } from '../test/fakeBrowser'
import { createFakeGitLab, fakeMergeRequest, fakeNote } from '../test/fakeGitLab'
import { server } from '../test/server'

const fake = createFakeBrowser()
vi.mock('webextension-polyfill', () => ({ default: fake }))
await import('../test/installExtensionPlatform')

const { saveHost } = await import('./hosts')
const { handleMessage, scrubToken } = await import('./router')

// The msw server lifecycle (listen/resetHandlers/close) is owned by
// src/test/setup.ts. Standing up a second setupServer() here would make every
// request resolver run twice.
const BASE = 'https://gitlab.example.com/api/v4'
const TARGET = { hostId: 'gitlab.example.com', project: 'p', iid: 1 }

beforeEach(async () => {
  fake.reset()
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
  fake.granted.add('https://gitlab.example.com/*')
  server.use(
    http.get(`${BASE}/projects/p/merge_requests/1`, () =>
      HttpResponse.json({ iid: 1, title: 'x' }),
    ),
  )
  await expect(
    handleMessage({ kind: 'delta/review', op: 'getMergeRequest', target: TARGET }),
  ).resolves.toMatchObject({ ok: true, data: { iid: 1 } })
})

test('getConfig is answered from the stored host', async () => {
  fake.granted.add('https://gitlab.example.com/*')
  await expect(
    handleMessage({ kind: 'delta/review', op: 'getConfig', target: TARGET }),
  ).resolves.toEqual({
    ok: true,
    data: { host: 'gitlab.example.com', project: 'p', mr_iid: 1 },
  })
})

test('an unknown host is a structured error, not a throw', async () => {
  await expect(
    handleMessage({
      kind: 'delta/review',
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
test('a revoked host permission on a review op is reported, not fetched blindly', async () => {
  await expect(
    handleMessage({ kind: 'delta/review', op: 'getMergeRequest', target: TARGET }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'permission_missing', status: 403 },
  })
})

test('a GitLab error becomes the shared envelope', async () => {
  fake.granted.add('https://gitlab.example.com/*')
  server.use(
    http.get(`${BASE}/projects/p/merge_requests/1`, () =>
      HttpResponse.json({ message: 'nope' }, { status: 401 }),
    ),
  )
  await expect(
    handleMessage({ kind: 'delta/review', op: 'getMergeRequest', target: TARGET }),
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
  fake.granted.add('https://gitlab.example.com/*')
  server.use(
    http.get(`${BASE}/projects/p/merge_requests/1`, () =>
      HttpResponse.json(
        { message: 'bad header PRIVATE-TOKEN=secret-token' },
        { status: 400 },
      ),
    ),
  )
  const response = await handleMessage({
    kind: 'delta/review',
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
  const response = await handleMessage({ kind: 'delta/hub', op: 'listHosts' })
  // Pinned to a real success: an error envelope would satisfy the absence
  // assertion below on its own.
  expect(response).toMatchObject({
    ok: true,
    data: [{ id: 'gitlab.example.com' }],
  })
  expect(JSON.stringify(response)).not.toContain('secret-token')
})

test('a revoked host permission is reported, not fetched blindly', async () => {
  await expect(
    handleMessage({ kind: 'delta/hub', op: 'listMergeRequests' }),
  ).resolves.toMatchObject({
    ok: true,
    data: [{ hostId: 'gitlab.example.com', error: 'permission_missing' }],
  })
})

test('a permitted host is fetched', async () => {
  fake.granted.add('https://gitlab.example.com/*')
  server.use(http.get(`${BASE}/merge_requests`, () => HttpResponse.json([])))
  await expect(
    handleMessage({ kind: 'delta/hub', op: 'listMergeRequests' }),
  ).resolves.toMatchObject({
    ok: true,
    data: [{ hostId: 'gitlab.example.com', reviewing: { items: [] } }],
  })
})

test('an unknown op is rejected', async () => {
  fake.granted.add('https://gitlab.example.com/*')
  await expect(
    handleMessage({
      kind: 'delta/review',
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

function storeInbox(items: ReturnType<typeof inboxItem>[]) {
  fake.data.inbox = {
    hosts: {
      'gitlab.example.com': {
        lastPollAt: '2026-09-24T12:00:00.000Z',
        lastEventsAt: null,
        mrs: {},
        items,
        error: null,
      },
    },
  }
}

test('listInbox answers from storage and never carries a token', async () => {
  storeInbox([inboxItem(2), inboxItem(1, true)])

  const response = await handleMessage({ kind: 'delta/hub', op: 'listInbox' })

  expect(response).toMatchObject({
    ok: true,
    data: { unread: 1, items: [{ noteId: 2 }, { noteId: 1 }] },
  })
  expect(JSON.stringify(response)).not.toContain('secret-token')
})

test('markRead marks the named items and updates the badge', async () => {
  storeInbox([inboxItem(2), inboxItem(1)])

  await expect(
    handleMessage({
      kind: 'delta/hub',
      op: 'markRead',
      payload: { ids: ['gitlab.example.com:2'] },
    }),
  ).resolves.toEqual({ ok: true, data: null })

  expect(fake.badge.text).toBe('1')
})

test('markAllRead clears the badge', async () => {
  storeInbox([inboxItem(2), inboxItem(1)])
  // What the badge showed before; an untouched badge must not pass.
  fake.badge.text = '2'

  await handleMessage({ kind: 'delta/hub', op: 'markAllRead' })

  expect(fake.badge.text).toBe('')
})

test('pollNow polls and returns the fresh inbox', async () => {
  fake.granted.add('https://gitlab.example.com/*')
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

  const response = await handleMessage({ kind: 'delta/hub', op: 'pollNow' })

  expect(response).toMatchObject({
    ok: true,
    data: { unread: 1, items: [{ id: 'gitlab.example.com:11' }] },
  })
})

test('listQueue returns each host’s MRs with facts, or its error', async () => {
  fake.granted.add('https://gitlab.example.com/*')
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(1))
  gitlab.lists.authored.push(1)

  const response = await handleMessage({ kind: 'delta/hub', op: 'listQueue' })

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
  fake.granted.add('https://gitlab.example.com/*')
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
    kind: 'delta/review',
    op: 'postComment',
    target: TARGET,
    payload: { body: '@ana Requesting changes: x' },
  })
  await handleMessage({
    kind: 'delta/review',
    op: 'replyToDiscussion',
    target: TARGET,
    payload: { discussionId: 'd', body: 'ok' },
  })
  expect(bodies).toEqual(['@ana Requesting changes: x\n\n*— via Mr. PR*', 'ok\n\n*— via Mr. PR*'])
})

test('getOverview returns the MR overview for the target', async () => {
  fake.granted.add('https://gitlab.example.com/*')
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(1, { project: 'p' }))
  const response = await handleMessage({
    kind: 'delta/review',
    op: 'getOverview',
    target: TARGET,
  })
  expect(response).toMatchObject({ ok: true, data: { iid: 1, title: 'MR 1' } })
})
