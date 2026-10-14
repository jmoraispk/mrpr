import { expect, test } from 'vitest'

import { cleanEmail, joinWaitlist, WAITLIST_KEY } from './_waitlist-core.js'

function fakeSet() {
  const sets = new Map<string, Set<string>>()
  return {
    sets,
    async add(key: string, member: string) {
      sets.set(key, (sets.get(key) ?? new Set()).add(member))
    },
  }
}

test('emails are trimmed, lowercased and checked', () => {
  expect(cleanEmail('  Ana@Example.COM ')).toBe('ana@example.com')
  expect(cleanEmail('no-at-sign')).toBeNull()
  expect(cleanEmail('a@b')).toBeNull()
  expect(cleanEmail(`${'a'.repeat(250)}@b.co`)).toBeNull()
  expect(cleanEmail(42)).toBeNull()
})

test('joining stores the email once, and joining again is still a success', async () => {
  const store = fakeSet()
  expect(await joinWaitlist(store, { email: 'Ana@example.com' })).toEqual({ status: 200, body: { ok: true } })
  expect(await joinWaitlist(store, { email: 'ana@example.com ' })).toEqual({ status: 200, body: { ok: true } })
  expect([...store.sets.get(WAITLIST_KEY)!]).toEqual(['ana@example.com'])
})

test('a missing or bad email is refused and nothing is stored', async () => {
  const store = fakeSet()
  for (const input of [null, {}, { email: 'nope' }, 'ana@example.com']) {
    expect(await joinWaitlist(store, input)).toEqual({ status: 400, body: { error: 'bad_email' } })
  }
  expect(store.sets.size).toBe(0)
})
