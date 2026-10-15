import { beforeEach, expect, test } from 'vitest'

import { installTestPlatform } from '../test/fakePlatform'

let fake = installTestPlatform()

const {
  getHost,
  getToken,
  hostIdFor,
  listHosts,
  removeHost,
  saveHost,
} = await import('./hosts')

const config = {
  id: 'gitlab.example.com',
  host: 'gitlab.example.com',
  apiBase: 'https://gitlab.example.com/api/v4',
  userId: 7,
  username: 'joao',
}

beforeEach(() => {
  fake = installTestPlatform()
})

test('an id is derived from the host', () => {
  expect(hostIdFor('  GitLab.Example.COM  ')).toBe('gitlab.example.com')
})

test('saving then listing round-trips', async () => {
  await saveHost(config, 'secret')
  await expect(listHosts()).resolves.toEqual([config])
  await expect(getHost(config.id)).resolves.toEqual(config)
  await expect(getToken(config.id)).resolves.toBe('secret')
})

test('saving the same host twice replaces it', async () => {
  await saveHost(config, 'secret')
  await saveHost({ ...config, username: 'renamed' }, 'newer')
  const hosts = await listHosts()
  expect(hosts).toHaveLength(1)
  expect(hosts[0].username).toBe('renamed')
  await expect(getToken(config.id)).resolves.toBe('newer')
})

test('removing a host wipes its token', async () => {
  await saveHost(config, 'secret')
  await removeHost(config.id)
  await expect(listHosts()).resolves.toEqual([])
  await expect(getToken(config.id)).resolves.toBeNull()
})

test('tokens live under a separate storage key from configs', async () => {
  await saveHost(config, 'secret')
  await expect(getToken(config.id)).resolves.toBe('secret')
  expect(JSON.stringify(await fake.store.get('hosts'))).not.toContain('secret')
})
