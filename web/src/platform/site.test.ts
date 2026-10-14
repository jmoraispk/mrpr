import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { waitFor } from '@testing-library/react'

import { AUTH_KEY } from '../site/auth'
import { pendingWriteAccess, settleWriteAccess } from '../site/writeAccess'
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

test('sign in again goes to the server whose session ended, not the first one configured', async () => {
  const OTHER = { host: 'gitlab.other.org', clientId: 'b'.repeat(64) }
  installPlatform(createSitePlatform({ hosts: [SITE, OTHER], scopes: 'api' }, createMemoryStore()))
  const assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign, hash: '#/', origin: window.location.origin })
  await platform().store.set({
    hosts: [{ ...HOST, id: OTHER.host, host: OTHER.host, apiBase: 'https://gitlab.other.org/api/v4' }],
    auth: {},
  })

  await platform().reauthenticate?.()

  expect(new URL(assign.mock.calls[0][0]).host).toBe('gitlab.other.org')
  vi.unstubAllGlobals()
})

test('a write from a read-only sign-in waits for posting rights, then goes out', async () => {
  const site = { host: 'gl.test', clientId: 'c' }
  installPlatform(createSitePlatform({ hosts: [site], scopes: 'read_api' }, createMemoryStore()))
  await platform().store.set({
    [AUTH_KEY]: { 'gl.test': { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, scopes: ['read_api'] } },
  })
  let posted = false
  server.use(
    http.post('https://gl.test/api/v4/x', () => {
      posted = true
      return HttpResponse.json({})
    }),
  )
  const client = await platform().clientFor({ id: 'gl.test', host: 'gl.test', apiBase: 'https://gl.test/api/v4', userId: 7, username: 'j' })
  const write = client.request('POST', '/x')
  await waitFor(() => expect(pendingWriteAccess()).toEqual(['gl.test']))
  expect(posted).toBe(false)
  settleWriteAccess('gl.test', true)
  await write
  expect(posted).toBe(true)
})
