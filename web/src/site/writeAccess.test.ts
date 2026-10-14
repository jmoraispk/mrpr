import { afterEach, expect, test } from 'vitest'

import {
  pendingWriteAccess,
  requestWriteAccess,
  settleWriteAccess,
  subscribeWriteAccess,
  WRITE_DENIED,
} from './writeAccess'

afterEach(() => {
  for (const host of pendingWriteAccess()) settleWriteAccess(host, false)
})

test('requests for one server share one question, and Allow lets them all through', async () => {
  let changes = 0
  const stop = subscribeWriteAccess(() => changes++)
  const first = requestWriteAccess('gl.test')
  const second = requestWriteAccess('gl.test')
  expect(pendingWriteAccess()).toEqual(['gl.test'])
  settleWriteAccess('gl.test', true)
  await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  expect(pendingWriteAccess()).toEqual([])
  expect(changes).toBe(2)
  stop()
})

test('Not now refuses with a coded error that says why', async () => {
  const waiting = requestWriteAccess('gl.test')
  settleWriteAccess('gl.test', false)
  await expect(waiting).rejects.toMatchObject({
    code: WRITE_DENIED,
    message: 'Posting needs your OK in GitLab.',
  })
})

test('two servers are asked one after the other', async () => {
  const a = requestWriteAccess('a.test')
  const b = requestWriteAccess('b.test')
  expect(pendingWriteAccess()).toEqual(['a.test', 'b.test'])
  settleWriteAccess('a.test', true)
  expect(pendingWriteAccess()).toEqual(['b.test'])
  settleWriteAccess('b.test', true)
  await expect(Promise.all([a, b])).resolves.toBeDefined()
})
