import { beforeEach, expect, test } from 'vitest'

import { lookup, registryKey, save, type RegistryEntry, type RegistryStore } from './core'

const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)
const NOW = new Date('2026-10-11T12:00:00.000Z')

let data: Map<string, RegistryEntry>
const store: RegistryStore = {
  get: async (key) => data.get(key) ?? null,
  setIfAbsent: async (key, value) => {
    if (data.has(key)) return false
    data.set(key, value)
    return true
  },
}

beforeEach(() => {
  data = new Map()
})

test('an unknown server is a 404, a known one gives its id', async () => {
  await expect(lookup(store, 'gitlab.example.com')).resolves.toEqual({ status: 404, body: { error: 'unknown' } })
  data.set(registryKey('gitlab.example.com'), { clientId: ID_A, savedAt: 'x' })
  await expect(lookup(store, 'GitLab.Example.com')).resolves.toEqual({ status: 200, body: { clientId: ID_A } })
})

test('a malformed host is refused', async () => {
  for (const host of ['', 'localhost', '10.0.0.1', 'a b.com', 'x.com:8443', 'https://x.com']) {
    await expect(lookup(store, host)).resolves.toMatchObject({ status: 400 })
    await expect(save(store, { host, clientId: ID_A }, NOW)).resolves.toMatchObject({ status: 400 })
  }
})

test('only a 64-hex id is accepted', async () => {
  for (const clientId of ['', 'gloas-' + 'a'.repeat(58), 'A'.repeat(63), 'z'.repeat(64)]) {
    await expect(save(store, { host: 'gitlab.example.com', clientId }, NOW)).resolves.toMatchObject({ status: 400 })
  }
})

test('the first id is stored and returned', async () => {
  await expect(save(store, { host: 'gitlab.example.com', clientId: ID_A }, NOW)).resolves.toEqual({
    status: 200,
    body: { clientId: ID_A },
  })
  expect(data.get(registryKey('gitlab.example.com'))).toEqual({ clientId: ID_A, savedAt: NOW.toISOString() })
})

test('an existing entry is never overwritten without replaces', async () => {
  await save(store, { host: 'gitlab.example.com', clientId: ID_A }, NOW)

  await expect(save(store, { host: 'gitlab.example.com', clientId: ID_B }, NOW)).resolves.toEqual({
    status: 200,
    body: { clientId: ID_A },
  })
  expect(data.get(registryKey('gitlab.example.com'))?.clientId).toBe(ID_A)
})

test('knowing the stored id does not let anyone replace it', async () => {
  // The stored id is public (GET returns it), so it proves nothing.
  await save(store, { host: 'gitlab.example.com', clientId: ID_A }, NOW)

  await expect(
    save(store, { host: 'gitlab.example.com', clientId: ID_B, replaces: ID_A }, NOW),
  ).resolves.toEqual({ status: 200, body: { clientId: ID_A } })
  expect(data.get(registryKey('gitlab.example.com'))?.clientId).toBe(ID_A)
})

test('shared public servers can never be claimed through the directory', async () => {
  for (const host of ['gitlab.com', 'GitLab.com', 'salsa.debian.org', 'gitlab.gnome.org']) {
    await expect(save(store, { host, clientId: ID_A }, NOW)).resolves.toEqual({
      status: 403,
      body: { error: 'operator_only' },
    })
  }
  expect(data.size).toBe(0)
})
