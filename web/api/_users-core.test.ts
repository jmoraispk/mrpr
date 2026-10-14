import { expect, test } from 'vitest'

import { recordUser, userKey } from './_users-core.js'

function fakeKeys() {
  const values = new Map<string, string>()
  return {
    values,
    async setIfAbsent(key: string, value: string) {
      if (values.has(key)) return false
      values.set(key, value)
      return true
    },
    async get(key: string) {
      return values.get(key) ?? null
    },
  }
}

test('the first visit is recorded once and never moves', async () => {
  const store = fakeKeys()
  const first = new Date('2026-10-14T12:00:00.000Z')
  expect(await recordUser(store, { host: 'GitLab.Example.com', userId: 7 }, first)).toEqual({
    status: 200,
    body: { ok: true, firstSeen: first.toISOString() },
  })
  const later = await recordUser(store, { host: 'gitlab.example.com', userId: 7 }, new Date('2026-11-01T00:00:00.000Z'))
  expect(later.body).toEqual({ ok: true, firstSeen: first.toISOString() })
  expect([...store.values.keys()]).toEqual([userKey('gitlab.example.com', 7)])
})

test('a bad host or user id is refused and nothing is stored', async () => {
  const store = fakeKeys()
  const now = new Date()
  expect(await recordUser(store, { host: 'not a host', userId: 7 }, now)).toEqual({ status: 400, body: { error: 'bad_host' } })
  for (const userId of [0, -1, 1.5, '7', null]) {
    expect(await recordUser(store, { host: 'gitlab.example.com', userId }, now)).toEqual({ status: 400, body: { error: 'bad_user' } })
  }
  expect(store.values.size).toBe(0)
})
