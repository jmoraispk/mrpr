import { expect, test } from 'vitest'

import { API, createFakeGitLab, fakeMergeRequest } from '../test/fakeGitLab'
import { GitLabClient } from './client'
import { fetchQueueMrs, fetchRepoMrs } from './queueFacts'

test('authored and review-requested MRs come back once each, with their facts', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(1, {
      facts: {
        author: 'joao',
        reviewers: [['ana', 'APPROVED']],
        additions: 4,
        deletions: 1,
        labels: ['agents'],
        pipeline: 'FAILED',
        needsRebase: true,
      },
    }),
  )
  gitlab.add(fakeMergeRequest(2, { facts: { reviewers: [['joao', 'UNREVIEWED']] } }))
  gitlab.lists.authored.push(1, 2)
  gitlab.lists.reviewing.push(2)

  const mrs = await fetchQueueMrs(new GitLabClient(API, 'secret'))

  expect(gitlab.calls).toEqual(['Facts'])
  expect(mrs.map((mr) => [mr.id, mr.roles])).toEqual([
    [1, ['author']],
    [2, ['author', 'reviewer']],
  ])
  expect(mrs[0]).toMatchObject({
    iid: 1,
    project: 'g/p',
    additions: 4,
    deletions: 1,
    labels: ['agents'],
    pipeline: 'FAILED',
    needsRebase: true,
    author: { username: 'joao', bot: false },
    reviewers: [{ username: 'ana', state: 'APPROVED' }],
  })
})

test('a reviewer listed twice is kept once', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(3, {
      facts: {
        reviewers: [
          ['ana', 'UNREVIEWED'],
          ['ana', 'APPROVED'],
        ],
      },
    }),
  )
  gitlab.lists.reviewing.push(3)
  const [mr] = await fetchQueueMrs(new GitLabClient(API, 'secret'))
  expect(mr.reviewers).toEqual([{ username: 'ana', name: 'ANA', state: 'APPROVED' }])
})

test('All MRs reads open MRs two repositories per request, with the paths as variables, role-less', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(fakeMergeRequest(1, { project: 'g/a' }))
  gitlab.add(fakeMergeRequest(2, { project: 'g/b' }))
  gitlab.add(fakeMergeRequest(3, { project: 'g/c' }))
  gitlab.add(fakeMergeRequest(4, { project: 'g/c', state: 'merged' }))

  const mrs = await fetchRepoMrs(new GitLabClient(API, 'secret'), ['g/a', 'g/b', 'g/c'])

  expect(gitlab.repoQueries.map((value) => Object.values(value.variables))).toEqual([['g/a', 'g/b'], ['g/c']])
  expect(gitlab.repoQueries[0].query).not.toContain('g/a')
  expect(mrs.map((mr) => [mr.id, mr.project, mr.roles])).toEqual([
    [1, 'g/a', []],
    [2, 'g/b', []],
    [3, 'g/c', []],
  ])
})
