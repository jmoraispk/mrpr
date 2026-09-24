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
