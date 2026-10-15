import { expect, test } from 'vitest'

import { API, createFakeGitLab, fakeMergeRequest, fakeNote } from '../test/fakeGitLab'
import { GitLabClient } from './client'
import { fetchMrOverview } from './mrOverview'

test('an MR overview comes back with REST-style ids for threads and notes', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(1, {
      overview: { description: 'Adds a **budget**.', shouldBeRebased: true },
      discussions: [
        {
          id: 'abc',
          resolvable: true,
          resolved: false,
          notes: [fakeNote(11, 'li', 'Why?', '2026-10-11T08:00:00Z')],
        },
        {
          id: 'def',
          notes: [
            fakeNote(12, 'ana', 'added 2 commits', '2026-10-11T09:00:00Z', {
              system: true,
              icon: 'commit',
            }),
          ],
        },
      ],
    }),
  )

  const mr = await fetchMrOverview(new GitLabClient(API, 'secret'), 'g/p', 1)

  expect(gitlab.calls).toEqual(['MrOverview'])
  expect(mr).toMatchObject({
    iid: 1,
    description: 'Adds a **budget**.',
    shouldBeRebased: true,
    canPush: true,
    reviewers: [{ username: 'joao', state: 'UNREVIEWED' }],
    labels: [{ title: 'agents' }],
    pipeline: { status: 'SUCCESS' },
    files: 1,
  })
  expect(mr.discussions).toEqual([
    {
      id: 'abc',
      resolvable: true,
      resolved: false,
      notes: [expect.objectContaining({ id: 11, system: false, body: 'Why?' })],
    },
    {
      id: 'def',
      resolvable: false,
      resolved: false,
      notes: [expect.objectContaining({ id: 12, system: true, icon: 'commit' })],
    },
  ])
})

test('an MR that is gone or hidden is a 404 with a plain sentence', async () => {
  createFakeGitLab()
  await expect(
    fetchMrOverview(new GitLabClient(API, 'secret'), 'g/p', 99),
  ).rejects.toMatchObject({
    status: 404,
    message: 'This merge request is gone or you no longer have access',
  })
})

test('an inline note keeps its file, line and the commits it was written against', async () => {
  const gitlab = createFakeGitLab()
  gitlab.add(
    fakeMergeRequest(1, {
      discussions: [
        {
          id: 'inline',
          resolvable: true,
          resolved: false,
          notes: [
            fakeNote(21, 'li', 'Why 3?', '2026-10-11T08:00:00Z', {
              position: { filePath: 'a.py', newLine: 3, oldLine: null, diffRefs: { baseSha: 'b1', headSha: 'h1' } },
            }),
          ],
        },
      ],
    }),
  )
  const mr = await fetchMrOverview(new GitLabClient(API, 'secret'), 'g/p', 1)
  expect(mr.discussions[0].notes[0].position).toEqual({
    filePath: 'a.py',
    newLine: 3,
    oldLine: null,
    baseSha: 'b1',
    headSha: 'h1',
  })
})
