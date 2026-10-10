import { expect, test, vi } from 'vitest'

import { createFakeBrowser } from './fakeBrowser'
import type { DeltaResponse } from '../extension/messages'

const fake = createFakeBrowser() as ReturnType<typeof createFakeBrowser> & {
  runtime: { sendMessage: (message: unknown) => Promise<DeltaResponse> }
}
const sent: unknown[] = []
let reply: () => Promise<DeltaResponse>
fake.runtime = {
  sendMessage: async (message) => {
    sent.push(message)
    return reply()
  },
}
vi.mock('webextension-polyfill', () => ({ default: fake }))
await import('../test/installExtensionPlatform')

const { createRuntimeTransport } = await import('../transport/runtime')

const TARGET = { hostId: 'h', project: 'group/p', iid: 42 }

test('the target key distinguishes merge requests', () => {
  expect(createRuntimeTransport(TARGET).targetKey).toBe('h/group/p/42')
  expect(createRuntimeTransport({ ...TARGET, iid: 43 }).targetKey).not.toBe(
    createRuntimeTransport(TARGET).targetKey,
  )
})

test('a successful response is unwrapped', async () => {
  sent.length = 0
  reply = async () => ({ ok: true, data: { iid: 42 } })
  await expect(
    createRuntimeTransport(TARGET).getMergeRequest(),
  ).resolves.toEqual({ iid: 42 })
  expect(sent[0]).toMatchObject({
    kind: 'delta/review',
    op: 'getMergeRequest',
    target: TARGET,
  })
})

test('an error response becomes an ApiError with code and status', async () => {
  reply = async () => ({
    ok: false,
    error: { code: 'gitlab_not_found', message: 'gone', status: 404 },
  })
  await expect(
    createRuntimeTransport(TARGET).getDiffs(),
  ).rejects.toMatchObject({ code: 'gitlab_not_found', status: 404, message: 'gone' })
})

test('a torn-down worker is retried exactly once', async () => {
  sent.length = 0
  let attempts = 0
  reply = async () => {
    attempts += 1
    if (attempts === 1) {
      throw new Error('The message port closed before a response was received.')
    }
    return { ok: true, data: [] }
  }
  await expect(createRuntimeTransport(TARGET).getDiscussions()).resolves.toEqual(
    [],
  )
  expect(attempts).toBe(2)
})

test('a second port failure is surfaced, not retried forever', async () => {
  reply = async () => {
    throw new Error('Receiving end does not exist.')
  }
  await expect(
    createRuntimeTransport(TARGET).getDiscussions(),
  ).rejects.toMatchObject({ code: 'extension_unavailable', status: 503 })
})

// A port-closed rejection means the response was lost, not that the worker
// never reached GitLab. Retrying a post risks a duplicate comment on the merge
// request, which is public and has to be deleted by hand.
test('createDiscussion is not retried, because a repeat could double-post', async () => {
  let attempts = 0
  reply = async () => {
    attempts += 1
    throw new Error('The message port closed before a response was received.')
  }
  await expect(
    createRuntimeTransport(TARGET).createDiscussion({
      old_path: 'a.py',
      new_path: 'a.py',
      start_old: null,
      start_new: 1,
      end_old: null,
      end_new: 2,
      body: 'hi',
    }),
  ).rejects.toMatchObject({ code: 'extension_unavailable', status: 503 })
  expect(attempts).toBe(1)
})

test('createDiscussion flattens the selection and body', async () => {
  sent.length = 0
  reply = async () => ({ ok: true, data: {} })
  await createRuntimeTransport(TARGET).createDiscussion({
    old_path: 'a.py',
    new_path: 'a.py',
    start_old: null,
    start_new: 1,
    end_old: null,
    end_new: 2,
    body: 'hi',
  })
  expect(sent[0]).toMatchObject({
    op: 'createDiscussion',
    payload: { new_path: 'a.py', body: 'hi' },
  })
})
