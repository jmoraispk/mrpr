import { beforeEach, expect, test, vi } from 'vitest'

import { installPlatform, platform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { FIRST_SEEN_KEY, recordFirstSeen } from './firstSeen'

const HOST = { id: 'gl.test', host: 'gl.test', apiBase: 'https://gl.test/api/v4', userId: 7, username: 'j' }

beforeEach(() => installPlatform(createFakePlatform()))

test('each signed-in user is reported once per browser', async () => {
  const post = vi.fn(async () => new Response('{}', { status: 200 }))
  await recordFirstSeen([HOST], post)
  await recordFirstSeen([HOST], post)
  expect(post).toHaveBeenCalledOnce()
  expect(post).toHaveBeenCalledWith({ host: 'gl.test', userId: 7 })
  await expect(platform().store.get(FIRST_SEEN_KEY)).resolves.toEqual(['gl.test:7'])
})

test('a failure is retried on the next visit, and never throws', async () => {
  const down = vi.fn(async () => {
    throw new Error('offline')
  })
  await expect(recordFirstSeen([HOST], down)).resolves.toBeUndefined()
  await expect(platform().store.get(FIRST_SEEN_KEY)).resolves.toBeUndefined()
  const up = vi.fn(async () => new Response('{}', { status: 200 }))
  await recordFirstSeen([HOST], up)
  expect(up).toHaveBeenCalledOnce()
})
