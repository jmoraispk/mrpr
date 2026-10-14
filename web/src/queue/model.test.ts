import { expect, test } from 'vitest'

import type { QueueMr } from '../gitlab/queueFacts'
import type { InboxItem } from '../inbox/types'
import { buildQueue, rowKey, todaysBudget, type QueueInput } from './model'

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
    needsRebase: false,
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
const me = { username: 'joao', name: 'J', avatarUrl: null, bot: false }

test('an MR you authored and review yourself is one row', () => {
  const rows = run([mr(1, { roles: ['author', 'reviewer'], author: me })])
  expect(rows).toHaveLength(1)
})

test('more blocked people score higher; drafts score lowest', () => {
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
  const score = (iid: number) => rows.find((row) => row.iid === iid)!.score
  expect(score(2)).toBeGreaterThan(score(3))
  expect(score(3)).toBeGreaterThan(score(1))
})

test('rows carry no buckets or badges any more', () => {
  const [row] = run([mr(1)])
  expect(row).not.toHaveProperty('bucket')
  expect(row).not.toHaveProperty('badges')
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
  expect(rows).toMatchObject([{ iid: 9, attention: 'needs-you', mr: null }])
})

test('today’s budget adds up what needs you', () => {
  const rows = run([
    mr(1, { additions: 100, deletions: 0 }),
    mr(2, { additions: 25, deletions: 0 }),
    mr(3, { reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] }),
  ])
  expect(todaysBudget(rows)).toBe(5)
})
const kinds = (row: ReturnType<typeof run>[number]) => row.tags.map((tag) => tag.kind)
const byIid = (rows: ReturnType<typeof run>, iid: number) => rows.find((row) => row.iid === iid)!

test('tags: a pending review with one approval left blocks the author and whoever approved', () => {
  const rows = run([
    mr(1),
    mr(2, {
      reviewers: [
        { username: 'joao', name: 'J', state: 'UNREVIEWED' },
        { username: 'li', name: 'Li', state: 'APPROVED' },
      ],
    }),
  ])
  expect(byIid(rows, 1).tags).toEqual(
    expect.arrayContaining([{ kind: 'blocking', people: 1 }, { kind: 'waiting-on-you' }]),
  )
  expect(byIid(rows, 2).tags).toEqual(expect.arrayContaining([{ kind: 'blocking', people: 2 }]))
  expect(byIid(rows, 1).attention).toBe('needs-you')
})

test('tags: Blocking only when your approval is the last one missing', () => {
  const rows = run([
    mr(1, { approvalsLeft: 2 }),
    mr(2, { reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] }),
    mr(3, { reviewers: [{ username: 'li', name: 'Li', state: 'UNREVIEWED' }] }),
    mr(4, { draft: true }),
    mr(5, { approvalsLeft: 0 }),
  ])
  for (const iid of [1, 2, 3, 4, 5]) expect(kinds(byIid(rows, iid))).not.toContain('blocking')
  expect(kinds(byIid(rows, 1))).toContain('waiting-on-you')
  expect(kinds(byIid(rows, 2))).not.toContain('waiting-on-you')
  expect(kinds(byIid(rows, 3))).not.toContain('waiting-on-you')
  expect(kinds(byIid(rows, 4))).toEqual(['waiting-on-you'])
})

test('tags: a small review is a quick win; a small MR that needs nothing from you is not', () => {
  const rows = run([
    mr(1, { additions: 20, deletions: 5 }),
    mr(2, { additions: 20, deletions: 5, reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] }),
  ])
  expect(byIid(rows, 1).tags).toEqual(expect.arrayContaining([{ kind: 'quick-win', minutes: 1 }]))
  expect(kinds(byIid(rows, 2))).not.toContain('quick-win')
})

test('tags: an unread reply waits on you, even after approving', () => {
  const [row] = run(
    [mr(1, { reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] })],
    { items: [item(1, 'reply')] },
  )
  expect(row.tags).toEqual([{ kind: 'waiting-on-you' }])
  expect(row.attention).toBe('needs-you')
})

test('tags: new commits after you asked for changes say changes were addressed', () => {
  const [row] = run(
    [mr(1, { reviewers: [{ username: 'joao', name: 'J', state: 'REQUESTED_CHANGES' }] })],
    { commitsSince: { [rowKey(H, 1)]: 4 } },
  )
  expect(row.tags).toEqual([{ kind: 'changes-addressed' }])
  expect(row).toMatchObject({ attention: 'returned', newCommits: 4 })
})

test('tags: new commits alone are no label, and an MR you approved stays done', () => {
  const [row] = run(
    [mr(1, { reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] })],
    { commitsSince: { [rowKey(H, 1)]: 3 } },
  )
  expect(row).toMatchObject({ tags: [], attention: 'done', newCommits: 3 })
})

test('tags: your MR is returned with changes requested or unread comments', () => {
  const mine = { roles: ['author' as const], author: me }
  const rows = run(
    [
      mr(1, { ...mine, reviewers: [{ username: 'ana', name: 'A', state: 'REQUESTED_CHANGES' }] }),
      mr(2, { ...mine, reviewers: [{ username: 'ana', name: 'A', state: 'APPROVED' }], approvalsLeft: 0 }),
    ],
    { items: [item(2, 'comment')] },
  )
  expect(kinds(byIid(rows, 1))).toContain('returned')
  expect(kinds(byIid(rows, 2))).toContain('returned')
  expect(byIid(rows, 2).attention).toBe('returned')
})

test('tags: your MR waiting on reviewers names them and counts the days', () => {
  const [row] = run([
    mr(1, {
      roles: ['author'],
      author: me,
      createdAt: '2026-10-09T12:00:00.000Z',
      reviewers: [{ username: 'john', name: 'John', state: 'UNREVIEWED' }],
    }),
  ])
  expect(row.tags).toEqual([{ kind: 'waiting-on-others', days: 2 }])
  expect(row.attention).toBe('waiting')
})

test('tags: quiet and approved is done; bot-authored is folded', () => {
  const rows = run([
    mr(1, { reviewers: [{ username: 'joao', name: 'J', state: 'APPROVED' }] }),
    mr(2, { author: { username: 'renovate', name: 'Renovate', avatarUrl: null, bot: true } }),
  ])
  expect(byIid(rows, 1)).toMatchObject({ attention: 'done', folded: false, tags: [] })
  expect(byIid(rows, 2).folded).toBe(true)
})

test('tags: no labels for drafts, failed pipelines or AI; a rebase only on your own MR', () => {
  const rows = run([
    mr(1, { draft: true, pipeline: 'FAILED', labels: ['agents'], additions: 600, deletions: 50 }),
    mr(2, { roles: ['author'], author: me, needsRebase: true }),
    mr(3, { needsRebase: true }),
  ])
  expect(kinds(byIid(rows, 1))).toEqual(['waiting-on-you'])
  expect(byIid(rows, 1).minutes).toBe(26)
  expect(kinds(byIid(rows, 2))).toContain('needs-rebase')
  expect(kinds(byIid(rows, 3))).not.toContain('needs-rebase')
})

test('tags: an MR without facts is tagged by its unread items', () => {
  const rows = run([], {
    items: [item(9, 'review_requested'), item(8, 'mention'), item(7, 'comment'), item(6, 'merged')],
  })
  expect(byIid(rows, 9)).toMatchObject({ tags: [{ kind: 'waiting-on-you' }], attention: 'needs-you', minutes: 0 })
  expect(byIid(rows, 8).tags).toEqual([{ kind: 'waiting-on-you' }])
  expect(byIid(rows, 7).tags).toEqual([{ kind: 'returned' }])
  expect(byIid(rows, 6)).toMatchObject({ tags: [], attention: 'done' })
})

test('tags: your own pushes are not new commits for you', () => {
  const [row] = run(
    [
      mr(1, {
        roles: ['author'],
        author: me,
        reviewers: [{ username: 'john', name: 'John', state: 'UNREVIEWED' }],
      }),
    ],
    { commitsSince: { [rowKey(H, 1)]: 3 } },
  )
  expect(row.newCommits).toBe(0)
  expect(row.attention).toBe('waiting')
})
