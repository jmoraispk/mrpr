import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test } from 'vitest'

import { listHosts } from '../extension/hosts'
import { installPlatform, platform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { server } from '../test/server'
import {
  accessToken,
  AUTH_KEY,
  AuthError,
  completeSignIn,
  PENDING_KEY,
  pkceChallenge,
  signIn,
  signOut,
} from './auth'
import { siteConfig } from './config'

const SITE = { host: 'gitlab.example.com', clientId: 'client-1' }
const CONFIG = { hosts: [SITE], scopes: 'api' }
const ORIGIN = 'https://gitlab.example.com'

beforeEach(() => {
  installPlatform(createFakePlatform())
  sessionStorage.clear()
})

test('the PKCE challenge is the RFC 7636 example', async () => {
  await expect(
    pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  ).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('the config is empty until a client id is set', () => {
  expect(siteConfig({})).toEqual({ hosts: [], scopes: 'api' })
  expect(siteConfig({ VITE_GITLAB_CLIENT_ID: 'abc' })).toEqual({
    hosts: [{ host: 'gitlab-master.nvidia.com', clientId: 'abc' }],
    scopes: 'api',
  })
})

test('signing in sends the browser to GitLab with every parameter', async () => {
  let target = ''
  await signIn(SITE, '#/mr/x', 'api', (url) => {
    target = url
  })

  const url = new URL(target)
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!)
  expect(`${url.origin}${url.pathname}`).toBe(`${ORIGIN}/oauth/authorize`)
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: 'client-1',
    redirect_uri: `${window.location.origin}/app/`,
    response_type: 'code',
    scope: 'api',
    state: pending.state,
    code_challenge: await pkceChallenge(pending.verifier),
    code_challenge_method: 'S256',
  })
  expect(pending).toMatchObject({ host: SITE.host, returnTo: '#/mr/x' })
})

async function pendingSignIn() {
  await signIn(SITE, '#/mr/x', 'api', () => {})
  return JSON.parse(sessionStorage.getItem(PENDING_KEY)!) as { state: string }
}

test('a return carrying the code finishes sign-in and saves the host', async () => {
  const { state } = await pendingSignIn()
  const bodies: Record<string, string>[] = []
  server.use(
    http.post(`${ORIGIN}/oauth/token`, async ({ request }) => {
      bodies.push(Object.fromEntries(new URLSearchParams(await request.text())))
      return HttpResponse.json({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    }),
    http.get(`${ORIGIN}/api/v4/user`, ({ request }) =>
      request.headers.get('Authorization') === 'Bearer at-1'
        ? HttpResponse.json({ id: 7, username: 'joao', name: 'Joao' })
        : HttpResponse.json({}, { status: 401 }),
    ),
  )

  const result = await completeSignIn(
    new URL(`${window.location.origin}/?code=c-1&state=${state}`),
    CONFIG,
  )

  expect(result).toEqual({ returnTo: '#/mr/x' })
  expect(bodies[0]).toMatchObject({
    grant_type: 'authorization_code',
    client_id: 'client-1',
    code: 'c-1',
    redirect_uri: `${window.location.origin}/app/`,
  })
  expect(bodies[0].code_verifier).toBeTruthy()
  await expect(listHosts()).resolves.toEqual([
    {
      id: SITE.host,
      host: SITE.host,
      apiBase: `${ORIGIN}/api/v4`,
      userId: 7,
      username: 'joao',
    },
  ])
  expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
})

test('a return without a pending sign-in is refused', async () => {
  await expect(
    completeSignIn(new URL(`${window.location.origin}/?code=c&state=s`), CONFIG),
  ).rejects.toMatchObject({ reason: 'no_pending' })
})

test('a return with the wrong state is refused', async () => {
  await pendingSignIn()
  await expect(
    completeSignIn(new URL(`${window.location.origin}/?code=c&state=forged`), CONFIG),
  ).rejects.toBeInstanceOf(AuthError)
})

test('a cancelled sign-in says so', async () => {
  const { state } = await pendingSignIn()
  await expect(
    completeSignIn(
      new URL(`${window.location.origin}/?error=access_denied&state=${state}`),
      CONFIG,
    ),
  ).rejects.toMatchObject({ reason: 'cancelled' })
})

async function storeAuth(expiresAt: number) {
  await platform().store.set({
    [AUTH_KEY]: {
      [SITE.host]: { accessToken: 'at-old', refreshToken: 'rt-old', expiresAt },
    },
  })
}

test('a fresh token is returned as it is', async () => {
  await storeAuth(1_000_000 + 10 * 60_000)
  await expect(accessToken(SITE, () => 1_000_000)).resolves.toBe('at-old')
})

test('refreshes within a minute of expiry and stores the rotated pair', async () => {
  await storeAuth(1_000_000 + 30_000)
  server.use(
    http.post(`${ORIGIN}/oauth/token`, async ({ request }) => {
      const body = Object.fromEntries(new URLSearchParams(await request.text()))
      expect(body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-old' })
      return HttpResponse.json({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 7200 })
    }),
  )

  await expect(accessToken(SITE, () => 1_000_000)).resolves.toBe('at-new')
  await expect(platform().store.get(AUTH_KEY)).resolves.toEqual({
    [SITE.host]: {
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresAt: 1_000_000 + 7_200_000,
    },
  })
})

test('concurrent callers share one refresh', async () => {
  await storeAuth(1_000_000)
  let refreshes = 0
  server.use(
    http.post(`${ORIGIN}/oauth/token`, () => {
      refreshes += 1
      return HttpResponse.json({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 7200 })
    }),
  )

  const tokens = await Promise.all([
    accessToken(SITE, () => 1_000_000),
    accessToken(SITE, () => 1_000_000),
  ])

  expect(tokens).toEqual(['at-new', 'at-new'])
  expect(refreshes).toBe(1)
})

test('a rejected refresh signs the host out', async () => {
  await storeAuth(1_000_000)
  server.use(
    http.post(`${ORIGIN}/oauth/token`, () =>
      HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
    ),
  )

  await expect(accessToken(SITE, () => 1_000_000)).rejects.toMatchObject({
    code: 'signed_out',
  })
  await expect(platform().store.get(AUTH_KEY)).resolves.toEqual({})
})

test('no stored token is signed out, not a crash', async () => {
  await expect(accessToken(SITE)).rejects.toMatchObject({ code: 'signed_out' })
})

test('signing out revokes, forgets the token and the host, and clears its inbox', async () => {
  await storeAuth(Date.now() + 3_600_000)
  await platform().store.set({
    hosts: [{ id: SITE.host, host: SITE.host, apiBase: `${ORIGIN}/api/v4`, userId: 7, username: 'joao' }],
    inbox: { hosts: { [SITE.host]: { lastPollAt: null, lastEventsAt: null, mrs: {}, items: [], error: null } } },
  })
  const revoked: string[] = []
  server.use(
    http.post(`${ORIGIN}/oauth/revoke`, async ({ request }) => {
      revoked.push(new URLSearchParams(await request.text()).get('token') ?? '')
      return HttpResponse.json({})
    }),
  )

  await signOut(SITE)

  expect(revoked).toEqual(['at-old'])
  await expect(platform().store.get(AUTH_KEY)).resolves.toEqual({})
  await expect(listHosts()).resolves.toEqual([])
  await expect(platform().store.get('inbox')).resolves.toEqual({ hosts: {} })
})

test('a refresh GitLab cannot answer keeps the session for the next try', async () => {
  for (const unavailable of [
    () => HttpResponse.json({ message: 'bad gateway' }, { status: 503 }),
    () => HttpResponse.error(),
  ]) {
    await storeAuth(1_000_000)
    server.use(http.post(`${ORIGIN}/oauth/token`, unavailable))

    await expect(accessToken(SITE, () => 1_000_000)).rejects.toMatchObject({
      code: 'gitlab_unavailable',
    })
    await expect(platform().store.get(AUTH_KEY)).resolves.toEqual({
      [SITE.host]: { accessToken: 'at-old', refreshToken: 'rt-old', expiresAt: 1_000_000 },
    })
  }
})

test('a sign-in started from a pasted setup completes even if the config lacks it, and is published after success', async () => {
  const OTHER = { host: 'gitlab.other.org', clientId: 'd'.repeat(64) }
  await signIn(OTHER, '#/', 'api', () => {}, { publish: {} })
  const { state } = JSON.parse(sessionStorage.getItem(PENDING_KEY)!)
  const published: unknown[] = []
  server.use(
    http.post('https://gitlab.other.org/oauth/token', () =>
      HttpResponse.json({ access_token: 'at', refresh_token: 'rt', expires_in: 7200 }),
    ),
    http.get('https://gitlab.other.org/api/v4/user', () => HttpResponse.json({ id: 1, username: 'u' })),
    http.post('/api/registry', async ({ request }) => {
      published.push(await request.json())
      return HttpResponse.json({ clientId: OTHER.clientId })
    }),
  )

  await completeSignIn(
    new URL(`${window.location.origin}/app/?code=c&state=${state}`),
    { hosts: [], scopes: 'api' },
  )

  await expect.poll(() => published).toEqual([
    { host: 'gitlab.other.org', clientId: OTHER.clientId },
  ])
})

test('nothing is published until a sign-in succeeds, and never for a looked-up id', async () => {
  const published: unknown[] = []
  server.use(
    http.post('/api/registry', async ({ request }) => {
      published.push(await request.json())
      return HttpResponse.json({})
    }),
    http.post(`${ORIGIN}/oauth/token`, () =>
      HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
    ),
  )
  await signIn(SITE, '#/', 'api', () => {}, { publish: {} })
  const first = JSON.parse(sessionStorage.getItem(PENDING_KEY)!)
  await expect(
    completeSignIn(new URL(`${window.location.origin}/app/?code=c&state=${first.state}`), CONFIG),
  ).rejects.toMatchObject({ reason: 'exchange_failed' })

  await signIn(SITE, '#/', 'api', () => {})
  expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!).publish).toBeUndefined()
  expect(published).toEqual([])
})
