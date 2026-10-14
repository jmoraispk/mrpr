import { expect, test } from 'vitest'

import { FEEDBACK_KEY, saveFeedback } from './_feedback-core.js'

const NOW = new Date('2026-10-14T12:00:00.000Z')

function fakeList() {
  const pushed: { key: string; value: string }[] = []
  return { pushed, async push(key: string, value: string) { pushed.push({ key, value }) } }
}

test('feedback keeps the message, an optional email, the version and the browser, nothing else', async () => {
  const store = fakeList()
  const reply = await saveFeedback(
    store,
    { message: '  Love it  ', email: 'Ana@example.com', version: 'abc1234', browser: 'Firefox', token: 'glpat-x', mr: 'code' },
    NOW,
  )
  expect(reply).toEqual({ status: 200, body: { ok: true } })
  expect(store.pushed).toHaveLength(1)
  expect(store.pushed[0].key).toBe(FEEDBACK_KEY)
  expect(JSON.parse(store.pushed[0].value)).toEqual({
    at: NOW.toISOString(),
    message: 'Love it',
    email: 'ana@example.com',
    version: 'abc1234',
    browser: 'Firefox',
  })
})

test('no email is fine; version and browser are cut to their limits', async () => {
  const store = fakeList()
  await saveFeedback(store, { message: 'x', version: 'v'.repeat(60), browser: 'b'.repeat(400) }, NOW)
  const record = JSON.parse(store.pushed[0].value)
  expect(record.email).toBeNull()
  expect(record.version).toHaveLength(40)
  expect(record.browser).toHaveLength(300)
})

test('an empty, blank or too long message, or a bad email, is refused', async () => {
  const store = fakeList()
  expect(await saveFeedback(store, null, NOW)).toEqual({ status: 400, body: { error: 'bad_message' } })
  expect(await saveFeedback(store, { message: '   ' }, NOW)).toEqual({ status: 400, body: { error: 'bad_message' } })
  expect(await saveFeedback(store, { message: 'x'.repeat(5001) }, NOW)).toEqual({ status: 400, body: { error: 'bad_message' } })
  expect(await saveFeedback(store, { message: 'hi', email: 'nope' }, NOW)).toEqual({ status: 400, body: { error: 'bad_email' } })
  expect(store.pushed).toHaveLength(0)
})
