import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { server } from '../test/server'
import { GitLabClient } from './client'
import { GitLabError } from './errors'

// The msw server lifecycle (listen/resetHandlers/close) is owned by
// src/test/setup.ts. Standing up a second setupServer() here would make every
// request resolver run twice.
const BASE = 'https://gitlab.example.com/api/v4'
const client = () => new GitLabClient(BASE, 'secret-token')

test('sends the private token header', async () => {
  let seen: string | null = null
  server.use(
    http.get(`${BASE}/user`, ({ request }) => {
      seen = request.headers.get('PRIVATE-TOKEN')
      return HttpResponse.json({ id: 7 })
    }),
  )
  await expect(client().request('GET', '/user')).resolves.toEqual({ id: 7 })
  expect(seen).toBe('secret-token')
})

test('maps 401 to gitlab_authentication_failed', async () => {
  server.use(
    http.get(`${BASE}/user`, () =>
      HttpResponse.json({ message: '401 Unauthorized' }, { status: 401 }),
    ),
  )
  await expect(client().request('GET', '/user')).rejects.toMatchObject({
    code: 'gitlab_authentication_failed',
    status: 401,
    message: '401 Unauthorized',
  })
})

test('maps 503 to gitlab_unavailable', async () => {
  server.use(
    http.get(`${BASE}/user`, () =>
      HttpResponse.json({ message: 'down' }, { status: 503 }),
    ),
  )
  await expect(client().request('GET', '/user')).rejects.toMatchObject({
    code: 'gitlab_unavailable',
    status: 503,
  })
})

test('maps a network failure to a 502', async () => {
  server.use(http.get(`${BASE}/user`, () => HttpResponse.error()))
  await expect(client().request('GET', '/user')).rejects.toMatchObject({
    code: 'gitlab_unavailable',
    status: 502,
    message: 'Could not reach GitLab',
  })
})

test('follows x-next-page', async () => {
  server.use(
    http.get(`${BASE}/things`, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      if (page === '1') {
        return HttpResponse.json([{ id: 1 }], {
          headers: { 'x-next-page': '2' },
        })
      }
      return HttpResponse.json([{ id: 2 }], { headers: { 'x-next-page': '' } })
    }),
  )
  await expect(client().paginate('/things')).resolves.toEqual([
    { id: 1 },
    { id: 2 },
  ])
})

test('GitLabError is thrown, not a plain object', async () => {
  server.use(
    http.get(`${BASE}/user`, () => HttpResponse.json({}, { status: 404 })),
  )
  await expect(client().request('GET', '/user')).rejects.toBeInstanceOf(
    GitLabError,
  )
})

test('graphql posts to the endpoint beside the REST base', async () => {
  const seen: { url: string; token: string | null; body: unknown }[] = []
  server.use(
    http.post('https://gitlab.example.com/api/graphql', async ({ request }) => {
      seen.push({
        url: request.url,
        token: request.headers.get('PRIVATE-TOKEN'),
        body: await request.json(),
      })
      return HttpResponse.json({ data: { currentUser: { username: 'joao' } } })
    }),
  )
  const client = new GitLabClient('https://gitlab.example.com/api/v4/', 'secret')

  await expect(
    client.graphql('query { currentUser { username } }', { a: 1 }),
  ).resolves.toEqual({ currentUser: { username: 'joao' } })
  expect(seen).toEqual([
    {
      url: 'https://gitlab.example.com/api/graphql',
      token: 'secret',
      body: { query: 'query { currentUser { username } }', variables: { a: 1 } },
    },
  ])
})

test('a GraphQL error array is raised, not returned as data', async () => {
  server.use(
    http.post('https://gitlab.example.com/api/graphql', () =>
      HttpResponse.json({
        errors: [{ message: 'Field x does not exist' }, { message: 'and y' }],
      }),
    ),
  )
  const client = new GitLabClient('https://gitlab.example.com/api/v4', 'secret')

  await expect(client.graphql('query { x }')).rejects.toMatchObject({
    status: 502,
    code: 'gitlab_graphql_error',
    message: 'Field x does not exist; and y',
  })
})

test('an HTTP failure on GraphQL keeps the REST error codes', async () => {
  server.use(
    http.post('https://gitlab.example.com/api/graphql', () =>
      HttpResponse.json({ message: '401 Unauthorized' }, { status: 401 }),
    ),
  )
  const client = new GitLabClient('https://gitlab.example.com/api/v4', 'secret')

  await expect(client.graphql('query { x }')).rejects.toMatchObject({
    status: 401,
    code: 'gitlab_authentication_failed',
  })
})

test('a token function authenticates with a bearer header, fetched per request', async () => {
  const seen: { auth: string | null; privateToken: string | null }[] = []
  server.use(
    http.get('https://gitlab.example.com/api/v4/user', ({ request }) => {
      seen.push({
        auth: request.headers.get('Authorization'),
        privateToken: request.headers.get('PRIVATE-TOKEN'),
      })
      return HttpResponse.json({ id: 1 })
    }),
  )
  let calls = 0
  const client = new GitLabClient('https://gitlab.example.com/api/v4', async () => {
    calls += 1
    return `oauth-${calls}`
  })

  await client.request('GET', '/user')
  await client.request('GET', '/user')

  expect(seen).toEqual([
    { auth: 'Bearer oauth-1', privateToken: null },
    { auth: 'Bearer oauth-2', privateToken: null },
  ])
})

test('the client scrubs its own credential out of error messages', async () => {
  server.use(
    http.get('https://gitlab.example.com/api/v4/user', () =>
      HttpResponse.json({ message: 'bad token secret-pat here' }, { status: 401 }),
    ),
    http.post('https://gitlab.example.com/api/graphql', () =>
      HttpResponse.json({ errors: [{ message: 'token oauth-x rejected' }] }),
    ),
  )

  await expect(
    new GitLabClient('https://gitlab.example.com/api/v4', 'secret-pat').request('GET', '/user'),
  ).rejects.toMatchObject({ message: 'bad token [redacted] here' })
  await expect(
    new GitLabClient('https://gitlab.example.com/api/v4', async () => 'oauth-x').graphql(
      'query { x }',
    ),
  ).rejects.toMatchObject({ message: 'token [redacted] rejected' })
})

test('only REST writes pass through the beforeWrite hook; reads and GraphQL never do', async () => {
  const calls: string[] = []
  server.use(
    http.get('https://gl.test/api/v4/thing', () => HttpResponse.json({ ok: 1 })),
    http.post('https://gl.test/api/v4/thing', () => HttpResponse.json({ ok: 2 })),
    http.post('https://gl.test/api/graphql', () => HttpResponse.json({ data: { ok: 3 } })),
  )
  const client = new GitLabClient('https://gl.test/api/v4', async () => 't', {
    beforeWrite: async () => {
      calls.push('gate')
    },
  })
  await client.request('GET', '/thing')
  await client.graphql('{ ok }')
  expect(calls).toEqual([])
  await client.request('POST', '/thing')
  expect(calls).toEqual(['gate'])
})

test('a refused beforeWrite stops the write before it is sent', async () => {
  let sent = false
  server.use(
    http.post('https://gl.test/api/v4/thing', () => {
      sent = true
      return HttpResponse.json({})
    }),
  )
  const client = new GitLabClient('https://gl.test/api/v4', async () => 't', {
    beforeWrite: async () => {
      throw new Error('no')
    },
  })
  await expect(client.request('POST', '/thing')).rejects.toThrow('no')
  expect(sent).toBe(false)
})
