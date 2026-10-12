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

/** An MR waiting on your review, known only to the queue's Facts query. */
const REVIEW = {
  id: 'gid://gitlab/MergeRequest/200',
  iid: '2',
  title: 'Retry budget for webhooks',
  webUrl: `${GITLAB}/g/q/-/merge_requests/2`,
  createdAt: NOW,
  updatedAt: NOW,
  project: { fullPath: 'g/q' },
}

function facts(
  mr: typeof MR & { createdAt?: string },
  author: string,
  reviewers: [string, string][],
  lines: [number, number],
) {
  return {
    ...mr,
    createdAt: mr.createdAt ?? NOW,
    draft: false,
    approved: false,
    approvalsLeft: 1,
    author: { username: author, name: author.toUpperCase(), avatarUrl: null, bot: false },
    reviewers: {
      nodes: reviewers.map(([username, reviewState]) => ({
        username,
        name: username.toUpperCase(),
        mergeRequestInteraction: { reviewState },
      })),
    },
    diffStatsSummary: { additions: lines[0], deletions: lines[1], fileCount: 1 },
    headPipeline: { status: 'SUCCESS' },
    labels: { nodes: [] },
    diffHeadSha: 'head-1',
    shouldBeRebased: false,
  }
}

/** Everything GitLab would answer, keyed by what the page asks for. */
async function fakeGitLab(
  page: Page,
  options: { expiresIn?: number; origin?: string } = {},
) {
  const tokenRequests: Record<string, string>[] = []
  const authorizeRequests: Record<string, string>[] = []
  /** What the review MR's head is now; tests move it to make new commits. */
  const state = { reviewHead: 'head-1' }
  const posted: { path: string; body: string }[] = []
  const approvals: string[] = []
  const compares: Record<string, string>[] = []
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
      if (query.startsWith('query Facts')) {
        return json({
          data: {
            currentUser: {
              authored: { nodes: [facts(MR, 'joao', [['john', 'UNREVIEWED']], [40, 8])] },
              reviewing: { nodes: [facts(REVIEW, 'ana', [['joao', 'UNREVIEWED']], [120, 10])] },
            },
          },
        })
      }
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
    const reviewPath = '/api/v4/projects/g%2Fq/merge_requests/2'
    if (url.pathname === reviewPath) {
      return json({
        iid: 2,
        title: REVIEW.title,
        web_url: REVIEW.webUrl,
        state: 'opened',
        source_branch: 'retry',
        target_branch: 'main',
        sha: state.reviewHead,
      })
    }
    if (url.pathname === `${reviewPath}/approve` || url.pathname === `${reviewPath}/unapprove`) {
      approvals.push(url.pathname.split('/').pop()!)
      return json({})
    }
    if (url.pathname === `${reviewPath}/discussions` && request.method() === 'POST') {
      posted.push({ path: url.pathname, body: (request.postDataJSON() as { body: string }).body })
      return json({ id: 'd9', notes: [] })
    }
    if (url.pathname === `${reviewPath}/diffs`) {
      return json(
        [{ old_path: 'src/retry.py', new_path: 'src/retry.py', diff: '@@ -1 +1 @@\n-a\n+b' }],
        { 'x-next-page': '' },
      )
    }
    if (url.pathname === `${reviewPath}/discussions`) return json([], { 'x-next-page': '' })
    if (url.pathname === '/api/v4/projects/g%2Fq/repository/compare') {
      compares.push(Object.fromEntries(url.searchParams))
      return json({
        diffs: [{ old_path: 'src/budget.py', new_path: 'src/budget.py', diff: '@@ -1 +1 @@\n-1\n+2' }],
      })
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
  return { tokenRequests, authorizeRequests, state, posted, approvals, compares }
}

async function signIn(page: Page) {
  await page.goto('/app/')
  await page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }).click()
  await expect(page.getByRole('navigation', { name: 'Queue' })).toBeVisible()
}

test('sign in, see the queue, open a comment at its thread', async ({ page }) => {
  await fakeGitLab(page)
  await signIn(page)

  const queue = page.getByRole('navigation', { name: 'Queue' })
  await expect(queue.getByRole('link', { name: /Needs you\s*1/ })).toBeVisible()
  const first = page.getByRole('article').first()
  await expect(first).toContainText('Retry budget for webhooks')
  await expect(first).toContainText('by ANA')

  // Ana's comment on your MR is folded into its row, in Returned to you.
  await expect(queue.getByRole('link', { name: /Returned to you\s*1/ })).toBeVisible()
  await page.getByRole('article').filter({ hasText: 'Improve parser errors' }).click()
  await page.getByRole('link', { name: 'Open review' }).click()
  await expect(page).toHaveURL(/#\/mr\/gitlab\.example\.com\/g%2Fp\/1\/note\/11$/)
  await expect(page.locator(':focus')).toHaveAttribute('data-discussion-id', 'd1')
})

test('approve from the keyboard', async ({ page }) => {
  const gitlab = await fakeGitLab(page)
  await signIn(page)
  await expect(page.getByRole('article').first()).toContainText('Retry budget for webhooks')

  await page.keyboard.press('j')
  await page.keyboard.press('k')
  await page.keyboard.press('a')

  await expect(page.getByRole('status')).toContainText('Approved Retry budget for webhooks')
  expect(gitlab.approvals).toEqual(['approve'])
})

test('request changes tags the author and is signed', async ({ page }) => {
  const gitlab = await fakeGitLab(page)
  await signIn(page)
  await expect(page.getByRole('article').first()).toContainText('Retry budget for webhooks')

  await page.keyboard.press('x')
  await page.getByRole('textbox').pressSequentially('add the invoice ID to the error')
  await page.getByRole('button', { name: 'Post' }).click()

  await expect.poll(() => gitlab.posted.length).toBe(1)
  expect(gitlab.posted[0].body).toBe(
    '@ana Requesting changes: add the invoice ID to the error\n\n*— via Mr. PR*',
  )
})

test('d shows only what changed since your last review', async ({ page }) => {
  const gitlab = await fakeGitLab(page)
  await signIn(page)
  await expect(page.getByRole('article').first()).toContainText('Retry budget for webhooks')

  // First look: open the review, which records head-1.
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/mr\/gitlab\.example\.com\/g%2Fq\/2$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Retry budget for webhooks' }),
  ).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('navigation', { name: 'Queue' })).toBeVisible()

  // New commits arrive.
  gitlab.state.reviewHead = 'head-2'
  await page.keyboard.press('d')

  await expect(page.getByRole('button', { name: 'Since your last review' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('region', { name: 'src/budget.py' })).toBeVisible()
  expect(gitlab.compares).toEqual([{ from: 'head-1', to: 'head-2', straight: 'false' }])
})

test('the queue has a dark mode and its own fonts, under the app’s security policy', async ({
  page,
}) => {
  const blocked: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) blocked.push(message.text())
  })
  await fakeGitLab(page)
  await signIn(page)

  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.q-shell')).toHaveCSS('background-color', 'rgb(15, 18, 24)')

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return (await document.fonts.load('16px "Geist Variable"')).length
  })
  expect(loaded).toBeGreaterThan(0)
  expect(blocked).toEqual([])
})

test('a token near expiry is refreshed before use', async ({ page }) => {
  const { tokenRequests } = await fakeGitLab(page, { expiresIn: 30 })
  await page.goto('/app/')
  await page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }).click()

  await expect(page.getByRole('navigation', { name: 'Queue' })).toBeVisible()
  await expect
    .poll(() => tokenRequests.map((body) => body.grant_type))
    .toContain('refresh_token')
})

test('signing out returns to the sign-in screen', async ({ page }) => {
  await fakeGitLab(page)
  await page.goto('/app/')
  await page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }).click()
  await expect(page.getByRole('navigation', { name: 'Queue' })).toBeVisible()

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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Coding got faster')

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

  await expect(page.getByRole('navigation', { name: 'Queue' })).toBeVisible()
  expect(authorizeRequests.map((request) => request.client_id)).toEqual([PASTED_ID])
  await expect.poll(() => posts).toEqual([{ host: 'gitlab.other.org', clientId: PASTED_ID }])
})

test('the next person from that server goes straight to GitLab', async ({ page }) => {
  const { authorizeRequests } = await fakeGitLab(page, { origin: OTHER })
  const { posts } = await fakeRegistry(page, { 'gitlab.other.org': PASTED_ID })
  await page.goto('/app/')

  await page.getByLabel('Paste a link to any merge request').fill(OTHER + '/g/p/-/merge_requests/1')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('navigation', { name: 'Queue' })).toBeVisible()
  expect(authorizeRequests.map((request) => request.client_id)).toEqual([PASTED_ID])
  await expect(page.getByText('Congratulations')).toHaveCount(0)
  expect(posts).toEqual([])
})

test('the landing page theme toggle works under its security policy', async ({ page }) => {
  await page.route(/fonts.(googleapis|gstatic).com/, (route) => route.abort())
  const blocked: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) blocked.push(message.text())
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('#page')).toHaveAttribute('data-theme', 'light')

  await page.getByRole('button', { name: 'Switch to dark mode' }).click()

  await expect(page.locator('#page')).toHaveAttribute('data-theme', 'dark')
  expect(blocked).toEqual([])
})
