import { delay, http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { createMemoryStore } from '../test/fakePlatform'
import { server as msw } from '../test/server'
import {
  loadCustomHosts,
  lookupDirectory,
  publishToDirectory,
  rememberHost,
  resolveServer,
  adoptSite,
} from './servers'

const ID = 'a'.repeat(64)
const SERVER = { host: 'gitlab.example.com', origin: 'https://gitlab.example.com' }

test('a pasted setup is remembered per host', async () => {
  const store = createMemoryStore()
  await rememberHost(store, { host: 'gitlab.example.com', clientId: ID })
  await rememberHost(store, { host: 'gitlab.other.org', clientId: 'b'.repeat(64) })
  await rememberHost(store, { host: 'gitlab.example.com', clientId: 'c'.repeat(64) })

  await expect(loadCustomHosts(store)).resolves.toEqual([
    { host: 'gitlab.example.com', clientId: 'c'.repeat(64) },
    { host: 'gitlab.other.org', clientId: 'b'.repeat(64) },
  ])
})

test('a known host resolves without asking the directory', async () => {
  const config = { hosts: [{ host: 'gitlab.example.com', clientId: ID }], scopes: 'api' }
  await expect(resolveServer(SERVER, config)).resolves.toEqual({
    site: { host: 'gitlab.example.com', clientId: ID },
    source: 'config',
  })
})

test('an unknown host asks the directory', async () => {
  msw.use(
    http.get('/api/registry/', ({ request }) =>
      new URL(request.url).searchParams.get('host') === 'gitlab.example.com'
        ? HttpResponse.json({ clientId: ID })
        : HttpResponse.json({ error: 'unknown' }, { status: 404 }),
    ),
  )
  const config = { hosts: [], scopes: 'api' }

  await expect(resolveServer(SERVER, config)).resolves.toEqual({
    site: { host: 'gitlab.example.com', clientId: ID },
    source: 'directory',
  })
  await expect(resolveServer({ host: 'x.org', origin: 'https://x.org' }, config)).resolves.toEqual({
    site: null,
    reason: 'unknown',
  })
})

test('a directory that cannot answer is told apart from an unknown server', async () => {
  for (const reply of [
    () => HttpResponse.error(),
    () => HttpResponse.json({ error: 'x' }, { status: 500 }),
    () => HttpResponse.text('not json'),
    () => HttpResponse.json({ clientId: 'not-an-id' }),
  ]) {
    msw.use(http.get('/api/registry/', reply))
    await expect(lookupDirectory('gitlab.example.com')).resolves.toEqual({ status: 'unavailable' })
  }
  msw.use(http.get('/api/registry/', () => HttpResponse.json({ error: 'unknown' }, { status: 404 })))
  await expect(lookupDirectory('gitlab.example.com')).resolves.toEqual({ status: 'unknown' })
})

test('a directory that stalls is given up on', async () => {
  msw.use(
    http.get('/api/registry/', async () => {
      await delay('infinite')
      return HttpResponse.json({})
    }),
  )
  await expect(lookupDirectory('gitlab.example.com', 50)).resolves.toEqual({ status: 'unavailable' })
})

test('publishing posts the host and id, and never throws', async () => {
  const bodies: unknown[] = []
  msw.use(
    http.post('/api/registry/', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json({}, { status: 500 })
    }),
  )

  await expect(publishToDirectory('gitlab.example.com', ID)).resolves.toBeUndefined()
  expect(bodies).toEqual([{ host: 'gitlab.example.com', clientId: ID }])
})

test('using a site adds or replaces it in the config', () => {
  const config = { hosts: [{ host: 'gitlab.example.com', clientId: ID }], scopes: 'api' }
  adoptSite(config, { host: 'gitlab.example.com', clientId: 'b'.repeat(64) })
  adoptSite(config, { host: 'gitlab.other.org', clientId: ID })
  expect(config.hosts).toEqual([
    { host: 'gitlab.example.com', clientId: 'b'.repeat(64) },
    { host: 'gitlab.other.org', clientId: ID },
  ])
})
