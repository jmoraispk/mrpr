import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { createFakeBrowser } from '../test/fakeBrowser'
import {
  API,
  createFakeGitLab,
  fakeMergeRequest,
  fakeNote,
  GRAPHQL,
  HOST,
} from '../test/fakeGitLab'
import { server } from '../test/server'

const fake = createFakeBrowser()
vi.mock('webextension-polyfill', () => ({ default: fake }))
await import('../test/installExtensionPlatform')

const { saveHost } = await import('../extension/hosts')
const { pollAll } = await import('./poller')
const { loadInbox, markRead, updateInbox } = await import('./store')

const NOW = new Date('2026-09-24T12:00:00.000Z')
const at = (minutes: number) => () =>
  new Date(NOW.getTime() + minutes * 60_000)
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString()

beforeEach(async () => {
  fake.reset()
  await saveHost(
    { id: HOST, host: HOST, apiBase: API, userId: 7, username: 'joao' },
    'secret-token',
  )
  fake.granted.add(`https://${HOST}/*`)
})

function withComment(gitlab: ReturnType<typeof createFakeGitLab>) {
  const mr = gitlab.add(
    fakeMergeRequest(1, {
      discussions: [{ id: 'd1', notes: [fakeNote(11, 'ana', 'Why?', hoursAgo(1))] }],
    }),
  )
  gitlab.lists.authored.push(1)
  return mr
}

test('a poll stores items and shows the unread count on the badge', async () => {
  withComment(createFakeGitLab())

  await pollAll({ now: at(0) })

  expect((await loadInbox()).hosts[HOST].items.map((item) => item.id)).toEqual([
    `${HOST}:11`,
  ])
  expect(fake.badge.text).toBe('1')
})

test('a revoked permission is recorded without a request', async () => {
  const gitlab = createFakeGitLab()
  fake.granted.clear()

  await pollAll({ now: at(0) })

  expect(gitlab.calls).toEqual([])
  expect((await loadInbox()).hosts[HOST].error?.code).toBe('permission_missing')
})

test('a rejected token is recorded, scrubbed, and earlier items survive', async () => {
  withComment(createFakeGitLab())
  await pollAll({ now: at(0) })
  server.use(
    http.post(GRAPHQL, () =>
      HttpResponse.json({ message: 'token secret-token revoked' }, { status: 401 }),
    ),
  )

  await pollAll({ now: at(2) })

  const inbox = await loadInbox()
  expect(inbox.hosts[HOST].error).toEqual({
    code: 'gitlab_authentication_failed',
    message: 'token [redacted] revoked',
  })
  expect(inbox.hosts[HOST].items).toHaveLength(1)
  expect(JSON.stringify(fake.data.inbox)).not.toContain('secret-token')
})

test('overlapping polls share one run', async () => {
  const gitlab = createFakeGitLab()

  await Promise.all([pollAll({ now: at(0) }), pollAll({ now: at(0) })])

  expect(gitlab.calls.filter((call) => call === 'Involved')).toHaveLength(1)
})

test('a recent poll is skipped when a maximum age is given', async () => {
  const gitlab = createFakeGitLab()
  await pollAll({ now: at(0) })
  gitlab.calls.length = 0

  await pollAll({ now: at(0.5), maxAgeMs: 60_000 })
  expect(gitlab.calls).toEqual([])

  await pollAll({ now: at(2), maxAgeMs: 60_000 })
  expect(gitlab.calls).toEqual(['Involved'])
})

test('marking read while a poll is in flight survives the poll', async () => {
  const gitlab = createFakeGitLab()
  const mr = withComment(gitlab)
  await pollAll({ now: at(0) })

  mr.discussions[0].notes.push(fakeNote(12, 'ana', 'And?', at(1)().toISOString()))
  mr.updatedAt = at(1)().toISOString()
  const release = gitlab.hold()
  const running = pollAll({ now: at(2) })
  await updateInbox((state) => markRead(state, [`${HOST}:11`]))
  release()
  await running

  const items = (await loadInbox()).hosts[HOST].items
  expect(items.map((item) => [item.noteId, item.read])).toEqual([
    [12, false],
    [11, true],
  ])
  expect(fake.badge.text).toBe('1')
})

test('a removed host’s inbox is dropped', async () => {
  createFakeGitLab()
  fake.data.inbox = {
    hosts: {
      'old.example.com': {
        lastPollAt: null,
        lastEventsAt: null,
        mrs: {},
        items: [],
        error: null,
      },
    },
  }

  await pollAll({ now: at(0) })

  expect(Object.keys((await loadInbox()).hosts)).toEqual([HOST])
})

test('the bot setting reaches the classifier', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(1, {
      discussions: [
        { id: 'd1', notes: [fakeNote(11, 'rabbit', 'Walkthrough', hoursAgo(1), { bot: true })] },
      ],
    }),
  )
  gitlab.lists.authored.push(1)
  fake.data.inboxSettings = { hideBots: false }

  await pollAll({ now: at(0) })

  expect((await loadInbox()).hosts[HOST].items).toHaveLength(1)
})
