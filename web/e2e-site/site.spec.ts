import { expect, test, type Page, type Route } from '@playwright/test'

const GITLAB = 'https://gitlab.example.com'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, private-token',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-expose-headers': 'x-next-page',
}
const NOW = new Date().toISOString()
const MR = {
  id: 'gid://gitlab/MergeRequest/100',
  iid: '1',
  title: 'Improve parser errors',
  webUrl: `${GITLAB}/g/p/-/merge_requests/1`,
  updatedAt: NOW,
  project: { fullPath: 'g/p' },
}

/** Everything GitLab would answer, keyed by what the page asks for. */
async function fakeGitLab(
  page: Page,
  options: { expiresIn?: number; origin?: string } = {},
) {
  const tokenRequests: Record<string, string>[] = []
  const authorizeRequests: Record<string, string>[] = []
  await page.route(`${options.origin ?? GITLAB}/**`, async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, extra: Record<string, string> = {}) =>
      route.fulfill({ status: 200, headers: { ...CORS, ...extra }, json: body })
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS })
    }
    if (url.pathname === '/oauth/authorize') {
      authorizeRequests.push(Object.fromEntries(url.searchParams))
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', 'code-1')
      back.searchParams.set('state', url.searchParams.get('state')!)
      return route.fulfill({ status: 302, headers: { location: back.toString() } })
    }
    if (url.pathname === '/oauth/token') {
      tokenRequests.push(Object.fromEntries(new URLSearchParams(request.postData() ?? '')))
      return json({
        access_token: `at-${tokenRequests.length}`,
        refresh_token: `rt-${tokenRequests.length}`,
        expires_in: options.expiresIn ?? 7200,
        token_type: 'Bearer',
      })
    }
    if (url.pathname === '/oauth/revoke') return json({})
    if (url.pathname === '/api/v4/user') return json({ id: 7, username: 'joao', name: 'Joao' })
    if (url.pathname === '/api/v4/events') return json([])
    if (url.pathname === '/api/graphql') {
      const query = (request.postDataJSON() as { query: string }).query
      if (query.startsWith('query Involved')) {
        return json({
          data: {
            currentUser: {
              authored: { nodes: [MR] },
              reviewing: { nodes: [] },
              assigned: { nodes: [] },
              todos: { nodes: [] },
            },
          },
        })
      }
      if (query.startsWith('query Activity')) {
        return json({
          data: {
            m100: {
              ...MR,
              state: 'opened',
              discussions: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'gid://gitlab/Discussion/d1',
                    notes: {
                      nodes: [
                        {
                          id: 'gid://gitlab/Note/11',
                          system: false,
                          createdAt: NOW,
                          url: `${MR.webUrl}#note_11`,
                          body: 'Why does this throw?',
                          author: { name: 'Ana', username: 'ana', avatarUrl: null, bot: false },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        })
      }
    }
    const mrPath = '/api/v4/projects/g%2Fp/merge_requests/1'
    if (url.pathname === mrPath) {
      return json({
        iid: 1,
        title: 'Improve parser errors',
        web_url: MR.webUrl,
        state: 'opened',
        source_branch: 'parser',
        target_branch: 'main',
      })
    }
    if (url.pathname === `${mrPath}/diffs`) {
      return json(
        [
          {
            old_path: 'src/parser.py',
            new_path: 'src/parser.py',
            diff: '@@ -1 +1 @@\n-old\n+new',
          },
        ],
        { 'x-next-page': '' },
      )
    }
    if (url.pathname === `${mrPath}/discussions`) {
      return json(
        [{ id: 'd1', notes: [{ id: 11, body: 'Why does this throw?', author: { name: 'Ana', username: 'ana' } }] }],
        { 'x-next-page': '' },
      )
    }
    return route.fulfill({ status: 404, headers: CORS, json: { message: `unmocked ${url.pathname}` } })
  })
  return { tokenRequests, authorizeRequests }
}

test('sign in, see a comment in the inbox, open it at its thread', async ({ page }) => {
  await fakeGitLab(page)
  await page.goto('/app/')

  await page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }).click()

  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  await page.getByRole('button', { name: /Ana commented/ }).click()
  await expect(page).toHaveURL(/#\/mr\/gitlab\.example\.com\/g%2Fp\/1\/note\/11$/)
  await expect(page.locator(':focus')).toHaveAttribute('data-discussion-id', 'd1')
})

test('a token near expiry is refreshed before use', async ({ page }) => {
  const { tokenRequests } = await fakeGitLab(page, { expiresIn: 30 })
  await page.goto('/app/')
  await page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }).click()

  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  await expect
    .poll(() => tokenRequests.map((body) => body.grant_type))
    .toContain('refresh_token')
})

test('signing out returns to the sign-in screen', async ({ page }) => {
  await fakeGitLab(page)
  await page.goto('/app/')
  await page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }).click()
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()

  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.reload()

  await expect(
    page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }),
  ).toBeVisible()
})

test('the landing page leads to the app', async ({ page }) => {
  // The landing page loads web fonts; keep the test off the network.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The code got faster')

  await page.getByRole('link', { name: 'Sign in', exact: true }).click()

  await expect(page).toHaveURL(/\/app\/$/)
  await expect(
    page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }),
  ).toBeVisible()
})

const OTHER = 'https://gitlab.other.org'
const PASTED_ID = 'ab'.repeat(32)

/** The shared directory, which vite preview does not serve. */
async function fakeRegistry(page: Page, known: Record<string, string> = {}) {
  const posts: unknown[] = []
  await page.route('**/api/registry**', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON())
      return route.fulfill({ json: { clientId: PASTED_ID } })
    }
    const host = new URL(request.url()).searchParams.get('host') ?? ''
    return known[host]
      ? route.fulfill({ json: { clientId: known[host] } })
      : route.fulfill({ status: 404, json: { error: 'unknown' } })
  })
  return { posts }
}

test('the first person from a new server sets it up, and it is shared', async ({ page }) => {
  const { authorizeRequests } = await fakeGitLab(page, { origin: OTHER })
  const { posts } = await fakeRegistry(page)
  await page.goto('/app/')

  await page.getByLabel('Paste a link to any merge request').fill(OTHER + '/g/p/-/merge_requests/1')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Congratulations')
  const widths = await page.locator('.setup-step img').evaluateAll((images) =>
    images.map((image) => (image as HTMLImageElement).naturalWidth),
  )
  expect(widths).toHaveLength(3)
  expect(widths.every((width) => width > 0)).toBe(true)

  await page.getByLabel('Application ID').fill(PASTED_ID)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  expect(authorizeRequests.map((request) => request.client_id)).toEqual([PASTED_ID])
  await expect.poll(() => posts).toEqual([{ host: 'gitlab.other.org', clientId: PASTED_ID }])
})

test('the next person from that server goes straight to GitLab', async ({ page }) => {
  const { authorizeRequests } = await fakeGitLab(page, { origin: OTHER })
  const { posts } = await fakeRegistry(page, { 'gitlab.other.org': PASTED_ID })
  await page.goto('/app/')

  await page.getByLabel('Paste a link to any merge request').fill(OTHER + '/g/p/-/merge_requests/1')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  expect(authorizeRequests.map((request) => request.client_id)).toEqual([PASTED_ID])
  await expect(page.getByText('Congratulations')).toHaveCount(0)
  expect(posts).toEqual([])
})
