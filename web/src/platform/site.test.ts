import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test } from 'vitest'

import { createMemoryStore } from '../test/fakePlatform'
import { server } from '../test/server'
import { installPlatform, platform } from './platform'
import { createSitePlatform } from './site'

const SITE = { host: 'gitlab.example.com', clientId: 'client-1' }
const HOST = {
  id: SITE.host,
  host: SITE.host,
  apiBase: 'https://gitlab.example.com/api/v4',
  userId: 7,
  username: 'joao',
}

beforeEach(() => {
  installPlatform(createSitePlatform({ hosts: [SITE], scopes: 'api' }, createMemoryStore()))
  document.head.innerHTML = '<link rel="icon" href="/favicon.svg" />'
})

test('a site client sends the stored OAuth token as a bearer, never a private token', async () => {
  await platform().store.set({
    auth: { [SITE.host]: { accessToken: 'at-1', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 } },
  })
  const seen: (string | null)[][] = []
  server.use(
    http.get('https://gitlab.example.com/api/v4/user', ({ request }) => {
      seen.push([request.headers.get('Authorization'), request.headers.get('PRIVATE-TOKEN')])
      return HttpResponse.json({ id: 7 })
    }),
  )

  await (await platform().clientFor(HOST)).request('GET', '/user')

  expect(seen).toEqual([['Bearer at-1', null]])
  expect(platform().needsToken).toBe(false)
  expect(platform().requestHostAccess).toBeUndefined()
})

test('a host the build does not configure has no client', async () => {
  await expect(
    platform().clientFor({ ...HOST, id: 'other.example.com', host: 'other.example.com' }),
  ).rejects.toMatchObject({ code: 'host_not_configured' })
})

test('ops run in the page', async () => {
  await platform().store.set({ hosts: [HOST] })
  await expect(platform().send({ kind: 'delta/hub', op: 'listHosts' })).resolves.toEqual({
    ok: true,
    data: [HOST],
  })
})

test('unread items put a dot on the tab icon', async () => {
  await platform().showUnread(2)
  expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
    '/favicon-unread.svg',
  )
  await platform().showUnread(0)
  expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/favicon.svg')
})
