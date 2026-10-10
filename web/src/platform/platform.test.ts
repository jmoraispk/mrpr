import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { createFakeBrowser } from '../test/fakeBrowser'
import { server } from '../test/server'

const fake = createFakeBrowser() as ReturnType<typeof createFakeBrowser> & {
  runtime: { sendMessage: (message: unknown) => Promise<unknown>; reload: () => void }
}
const sent: unknown[] = []
fake.runtime = {
  sendMessage: async (message) => {
    sent.push(message)
    return { ok: true, data: 'pong' }
  },
  reload: vi.fn(),
}
vi.mock('webextension-polyfill', () => ({ default: fake }))

const { installPlatform, platform } = await import('./platform')
const { createExtensionPlatform } = await import('./extension')
const { getToken, listHosts, saveHost } = await import('../extension/hosts')

const HOST = {
  id: 'gitlab.example.com',
  host: 'gitlab.example.com',
  apiBase: 'https://gitlab.example.com/api/v4',
  userId: 7,
  username: 'joao',
}

beforeEach(() => {
  fake.reset()
  sent.length = 0
})

test('using the platform before installing one says so', async () => {
  vi.resetModules()
  const fresh = await import('./platform')
  expect(() => fresh.platform()).toThrow('No platform installed')
})

test('the extension store reads, writes and reports changed keys', async () => {
  installPlatform(createExtensionPlatform())
  const changed: string[][] = []
  const stop = platform().store.subscribe((keys) => changed.push(keys))

  await platform().store.set({ a: 1, b: { c: 2 } })
  await platform().store.remove('a')

  await expect(platform().store.get('b')).resolves.toEqual({ c: 2 })
  await expect(platform().store.get('a')).resolves.toBeUndefined()
  expect(changed).toEqual([['a', 'b'], ['a']])
  stop()
  await platform().store.set({ d: 3 })
  expect(changed).toHaveLength(2)
})

test('an extension client needs a stored token and a granted permission', async () => {
  installPlatform(createExtensionPlatform())
  await saveHost(HOST)
  await expect(platform().clientFor(HOST)).rejects.toMatchObject({
    code: 'host_not_configured',
  })

  await saveHost(HOST, 'secret')
  await expect(platform().clientFor(HOST)).rejects.toMatchObject({
    code: 'permission_missing',
  })

  fake.granted.add('https://gitlab.example.com/*')
  server.use(
    http.get('https://gitlab.example.com/api/v4/user', ({ request }) =>
      HttpResponse.json({ token: request.headers.get('PRIVATE-TOKEN') }),
    ),
  )
  const client = await platform().clientFor(HOST)
  await expect(client.request('GET', '/user')).resolves.toEqual({ token: 'secret' })
})

test('connecting a host checks the token, then saves host and token', async () => {
  installPlatform(createExtensionPlatform())
  server.use(
    http.get('https://gitlab.example.com/api/v4/user', () =>
      HttpResponse.json({ id: 7, username: 'joao', name: 'Joao' }),
    ),
  )

  await expect(
    platform().connectHost({
      host: 'GitLab.Example.com',
      apiBase: 'https://gitlab.example.com/api/v4',
      token: 'secret',
    }),
  ).resolves.toEqual(HOST)
  await expect(listHosts()).resolves.toEqual([HOST])
  await expect(getToken(HOST.id)).resolves.toBe('secret')

  await platform().disconnectHost(HOST.id)
  await expect(listHosts()).resolves.toEqual([])
  await expect(getToken(HOST.id)).resolves.toBeNull()
})

test('messages go to the worker, and the badge and reload are wired', async () => {
  installPlatform(createExtensionPlatform())

  await expect(
    platform().send({ kind: 'delta/hub', op: 'listHosts' }),
  ).resolves.toEqual({ ok: true, data: 'pong' })
  await platform().showUnread(3)
  platform().reload?.()

  expect(sent).toEqual([{ kind: 'delta/hub', op: 'listHosts' }])
  expect(fake.badge.text).toBe('3')
  expect(fake.runtime.reload).toHaveBeenCalledOnce()
  expect(platform().needsToken).toBe(true)
})
