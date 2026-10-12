import { expect, test } from 'vitest'

import type { QueueMr } from '../gitlab/queueFacts'
import type { InboxItem } from '../inbox/types'
import { bucketCounts, buildQueue, rowKey, todaysBudget, type QueueInput } from './model'

const NOW = new Date('2026-10-11T12:00:00.000Z')
const H = 'gitlab.example.com'

function mr(id: number, over: Partial<QueueMr> = {}): QueueMr {
  return {
    id,
    iid: id,
    project: 'g/p',
    title: `MR ${id}`,
    webUrl: `https://${H}/g/p/-/merge_requests/${id}`,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T10:00:00.000Z',
    roles: ['reviewer'],
    draft: false,
    approved: false,
    approvalsLeft: 1,
    author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
    reviewers: [{ username: 'joao', name: 'Joao', state: 'UNREVIEWED' }],
    additions: 100,
    deletions: 20,
    files: 3,
    pipeline: 'SUCCESS',
    labels: [],
    headSha: 'h1',
    ...over,
  }
}

function item(mrId: number, kind: InboxItem['kind'], read = false): InboxItem {
  return {
    id: `${H}:${mrId}${kind}`,
    kind,
    hostId: H,
    mrId,
    project: 'g/p',
    iid: mrId,
    mrTitle: 'x',
    discussionId: 'd',
    noteId: 1,
    author: null,
    excerpt: '',
    createdAt: NOW.toISOString(),
    webUrl: '',
    read,
  }
}

function run(mrs: QueueMr[], over: Partial<QueueInput> = {}) {
  return buildQueue({
    hosts: [{ hostId: H, host: H, username: 'joao', mrs, error: null }],
    items: [],
    snoozed: {},
    commitsSince: {},
    now: NOW,
    ...over,
  })
}
const buckets = (rows: ReturnType<typeof run>) => rows.map((row) => [row.iid, row.bucket])
const me = { username: 'joao', name: 'J', avatarUrl: null, bot: false }

test('a pending review needs you; a small one is a quick win', () => {
  expect(buckets(run([mr(1), mr(2, { additions: 20, deletions: 5 })]))).toEqual([
    [1, 'needs-you'],
    [2, 'quick-wins'],
  ])
})

test('an unread reply or mention needs you even after approving', () => {
  const rows = run([mr(1, { reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] })], {
    items: [item(1, 'reply')],
  })
  expect(rows[0]).toMatchObject({
    bucket: 'needs-you',
    badges: expect.arrayContaining([{ kind: 'threads-waiting', count: 1 }]),
  })
})

test('your MR with changes requested or unread comments is returned to you', () => {
  const mine = { roles: ['author' as const], author: me }
  expect(
    buckets(
      run(
        [
          mr(1, { ...mine, reviewers: [{ username: 'ana', name: 'A', state: 'REQUESTED_CHANGES' }] }),
          mr(2, {
            ...mine,
            reviewers: [{ username: 'ana', name: 'A', state: 'APPROVED' }],
            approvalsLeft: 0,
          }),
        ],
        { items: [item(2, 'comment')] },
      ),
    ),
  ).toEqual([
    [1, 'returned'],
    [2, 'returned'],
  ])
})

test('new commits on an MR you reviewed bring it back, and say changes were addressed', () => {
  const rows = run(
    [mr(1, { reviewers: [{ username: 'joao', name: 'J', state: 'REQUESTED_CHANGES' }] })],
    { commitsSince: { [rowKey(H, 1)]: 4 } },
  )
  expect(rows[0].bucket).toBe('returned')
  expect(rows[0].badges).toEqual(
    expect.arrayContaining([{ kind: 'commits-since', count: 4 }, { kind: 'changes-addressed' }]),
  )
})

test('your MR still needing approvals is waiting on others, naming them', () => {
  const rows = run([
    mr(1, {
      roles: ['author'],
      author: me,
      createdAt: '2026-10-09T12:00:00.000Z',
      reviewers: [{ username: 'john', name: 'John', state: 'UNREVIEWED' }],
    }),
  ])
  expect(rows[0].bucket).toBe('waiting')
  expect(rows[0].badges).toEqual(
    expect.arrayContaining([{ kind: 'waiting-on', names: ['John'], days: 2 }]),
  )
})

test('quiet and approved is done; bot-authored is folded', () => {
  expect(
    buckets(
      run([
        mr(1, { reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] }),
        mr(2, { author: { username: 'renovate', name: 'Renovate', avatarUrl: null, bot: true } }),
      ]),
    ),
  ).toEqual([
    [1, 'done'],
    [2, 'folded'],
  ])
})

test('an MR you authored and review yourself is one row', () => {
  const rows = run([mr(1, { roles: ['author', 'reviewer'], author: me })])
  expect(rows).toHaveLength(1)
})

test('blocking counts the author and reviewers who already approved', () => {
  const rows = run([
    mr(1, {
      reviewers: [
        { username: 'joao', name: 'J', state: 'UNREVIEWED' },
        { username: 'li', name: 'Li', state: 'APPROVED' },
      ],
    }),
  ])
  expect(rows[0].badges).toEqual(expect.arrayContaining([{ kind: 'blocking', count: 2 }]))
})

test('badges for size, drafts, failed pipelines and agent-written MRs', () => {
  const [row] = run([
    mr(1, { draft: true, pipeline: 'FAILED', labels: ['agents'], additions: 600, deletions: 50 }),
  ])
  expect(row.badges).toEqual(
    expect.arrayContaining([
      { kind: 'draft' },
      { kind: 'pipeline-failed' },
      { kind: 'ai-authored' },
      { kind: 'size', size: 'L', minutes: 26 },
    ]),
  )
})

test('more blocked people rank first; drafts rank last', () => {
  const rows = run([
    mr(1, { draft: true }),
    mr(2, {
      reviewers: [
        { username: 'joao', name: 'J', state: 'UNREVIEWED' },
        { username: 'li', name: 'Li', state: 'APPROVED' },
      ],
    }),
    mr(3),
  ])
  expect(rows.map((row) => row.iid)).toEqual([2, 3, 1])
})

test('a snoozed row stays hidden until the MR changes', () => {
  const key = rowKey(H, 1)
  const snoozed = { [key]: '2026-10-11T10:00:00.000Z' }
  expect(run([mr(1)], { snoozed })[0].snoozed).toBe(true)
  expect(run([mr(1, { updatedAt: '2026-10-11T11:00:00.000Z' })], { snoozed })[0].snoozed).toBe(
    false,
  )
})

test('unread items for an MR without facts still make a row', () => {
  const rows = run([], { items: [item(9, 'mention')] })
  expect(rows).toMatchObject([{ iid: 9, bucket: 'needs-you', mr: null }])
})

test('a merged or closed notice for an MR without facts is done, not returned', () => {
  const rows = run([], { items: [item(8, 'merged'), item(7, 'closed')] })
  expect(rows.map((row) => row.bucket)).toEqual(['done', 'done'])
})

test('counts skip snoozed rows', () => {
  const rows = run([mr(1), mr(2)], { snoozed: { [rowKey(H, 2)]: '2026-10-11T10:00:00.000Z' } })
  expect(bucketCounts(rows)['needs-you']).toBe(1)
})

test('today’s budget adds up what needs you', () => {
  const rows = run([
    mr(1, { additions: 100, deletions: 0 }),
    mr(2, { additions: 25, deletions: 0 }),
    mr(3, { reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] }),
  ])
  expect(todaysBudget(rows)).toBe(5)
})
