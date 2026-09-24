import { expect, test } from 'vitest'

import {
  API,
  createFakeGitLab,
  fakeMergeRequest,
  fakeNote,
} from '../test/fakeGitLab'
import {
  fetchActivity,
  fetchCommentedMergeRequestIds,
  fetchInvolved,
} from './activity'
import { GitLabClient } from './client'

const client = () => new GitLabClient(API, 'secret')
const T = '2026-09-23T10:00:00.000Z'

test('one request returns every involved merge request with its roles merged', async () => {
  const gitlab = createFakeGitLab()
  for (const id of [1, 2, 3]) gitlab.add(fakeMergeRequest(id))
  gitlab.lists.authored.push(1)
  gitlab.lists.assigned.push(1)
  gitlab.lists.reviewing.push(2)
  gitlab.lists.todos.push(3, 'issue')

  const involved = await fetchInvolved(client(), [])

  expect(gitlab.calls).toEqual(['Involved'])
  expect(involved.listed.map((mr) => [mr.id, mr.roles])).toEqual([
    [1, ['author', 'assignee']],
    [2, ['reviewer']],
    [3, ['mentioned']],
  ])
  expect(involved.listed[0]).toEqual({
    id: 1,
    iid: 1,
    project: 'g/p',
    title: 'MR 1',
    webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
    updatedAt: '2026-09-20T10:00:00.000Z',
    roles: ['author', 'assignee'],
  })
})

test('extra merge requests ride along in the same request', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(9, { state: 'merged', updatedAt: '2026-09-21T00:00:00.000Z' }),
  )

  const involved = await fetchInvolved(client(), [9, 404])

  expect(gitlab.calls).toEqual(['Involved'])
  expect(gitlab.involvedQueries[0]).toContain(
    'm9: mergeRequest(id: "gid://gitlab/MergeRequest/9")',
  )
  // 404 came back null: deleted, or no longer visible to this user.
  expect(involved.extra).toEqual({
    9: { updatedAt: '2026-09-21T00:00:00.000Z', state: 'merged' },
  })
})

test('activity is fetched ten merge requests per request', async () => {
  const gitlab = createFakeGitLab()
  const ids = Array.from({ length: 25 }, (_, index) => index + 1)
  for (const id of ids) gitlab.add(fakeMergeRequest(id))

  const activity = await fetchActivity(client(), ids)

  expect(gitlab.calls).toEqual(['Activity', 'Activity', 'Activity'])
  expect([...activity.keys()]).toEqual(ids)
})

test('notes and discussions come back with REST ids', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(1, {
      discussions: [{ id: 'abc', notes: [fakeNote(70, 'ana', 'Looks good', T)] }],
    }),
  )

  const mr = (await fetchActivity(client(), [1])).get(1)

  expect(mr?.state).toBe('opened')
  expect(mr?.discussions).toEqual([
    {
      id: 'abc',
      notes: [
        {
          id: 70,
          system: false,
          createdAt: T,
          url: 'https://gitlab.example.com/g/p/-/merge_requests/1#note_70',
          body: 'Looks good',
          author: {
            name: 'ANA',
            username: 'ana',
            avatarUrl: '/uploads/ana.png',
            bot: false,
          },
        },
      ],
    },
  ])
})

test('a merge request with more discussions than a page is followed by cursor', async () => {
  const gitlab = createFakeGitLab()
  gitlab.setPageSize(2)
  gitlab.add(
    fakeMergeRequest(1, {
      discussions: [1, 2, 3, 4, 5].map((n) => ({
        id: `d${n}`,
        notes: [fakeNote(n, 'ana', `note ${n}`, T)],
      })),
    }),
  )

  const mr = (await fetchActivity(client(), [1])).get(1)

  expect(gitlab.calls).toEqual(['Activity', 'MoreDiscussions', 'MoreDiscussions'])
  expect(mr?.discussions.map((discussion) => discussion.id)).toEqual([
    'd1',
    'd2',
    'd3',
    'd4',
    'd5',
  ])
})

test('a merge request GitLab no longer returns is left out', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(1))

  const activity = await fetchActivity(client(), [1, 2])

  expect([...activity.keys()]).toEqual([1])
})

test('own comments are mapped to the merge requests they were left on', async () => {
  const gitlab = createFakeGitLab()
  gitlab.events.push(
    { noteableId: 5, createdAt: '2026-09-23T10:00:00.000Z' },
    { noteableId: 5, createdAt: '2026-09-23T11:00:00.000Z' },
    { noteableId: 6, createdAt: '2026-09-20T10:00:00.000Z' },
    { noteableId: 7, createdAt: '2026-09-23T12:00:00.000Z', type: 'Issue' },
  )

  const ids = await fetchCommentedMergeRequestIds(
    client(),
    new Date('2026-09-22T00:00:00.000Z'),
  )

  expect(ids).toEqual([5])
  // `after` is an exclusive date, so the day before is asked for and the
  // timestamps do the precise cut.
  expect(gitlab.eventQueries).toEqual([
    { action: 'commented', target_type: 'note', after: '2026-09-21', per_page: '100' },
  ])
})
