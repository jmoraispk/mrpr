import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Browser-level diff performance, measured through the site the way a reader
 * reaches it: sign in with GitLab, open a merge request, read the Changes tab.
 *
 * Everything GitLab answers is stubbed, so the numbers are the browser's work
 * alone — the lazily loaded diff chunk, the worker that parses and highlights,
 * the virtualized stream, and the real scroll container. Each test prints its
 * measurements, so a threshold failure is diagnosable without a rerun.
 */

const GITLAB = 'https://gitlab.example.com'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, private-token',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-expose-headers': 'x-next-page',
}
const NOW = new Date().toISOString()
const PROJECT = 'g/perf'
const IID = 1
const MR_PATH = `/api/v4/projects/${encodeURIComponent(PROJECT)}/merge_requests/${IID}`
const CHANGES_HASH = `#/mr/gitlab.example.com/${encodeURIComponent(PROJECT)}/${IID}/changes/full`

interface DiffFile {
  old_path: string
  new_path: string
  diff: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  collapsed: boolean
  too_large: boolean
}

function makeDiff(changedLines: number, fileIndex: number): string {
  const removedCount = Math.floor(changedLines / 2)
  const addedCount = changedLines - removedCount
  return [
    `@@ -1,${removedCount} +1,${addedCount} @@`,
    ...Array.from(
      { length: removedCount },
      (_, line) => `-const old_${fileIndex}_${line} = ${line};`,
    ),
    ...Array.from(
      { length: addedCount },
      (_, line) => `+const new_${fileIndex}_${line} = ${line};`,
    ),
  ].join('\n')
}

function makeFiles(count: number, linesPerFile: number): DiffFile[] {
  return Array.from({ length: count }, (_, index) => ({
    old_path: `src/area-${index % 20}/module-${index % 7}/file-${index}.ts`,
    new_path: `src/area-${index % 20}/module-${index % 7}/file-${index}.ts`,
    diff: makeDiff(linesPerFile, index),
    new_file: false,
    renamed_file: false,
    deleted_file: false,
    collapsed: false,
    too_large: false,
  }))
}

const person = (username: string) => ({
  username,
  name: username.toUpperCase(),
  avatarUrl: null,
  bot: false,
})

/** The benchmark MR as the queue's Facts query reports it. */
function facts(files: DiffFile[]) {
  return {
    id: 'gid://gitlab/MergeRequest/100',
    iid: String(IID),
    title: 'Diff performance fixture',
    webUrl: `${GITLAB}/${PROJECT}/-/merge_requests/${IID}`,
    createdAt: NOW,
    updatedAt: NOW,
    state: 'opened',
    mergedAt: null,
    project: { fullPath: PROJECT },
    draft: false,
    approved: false,
    approvalsLeft: 1,
    author: person('ana'),
    reviewers: {
      nodes: [{ ...person('joao'), mergeRequestInteraction: { reviewState: 'UNREVIEWED' } }],
    },
    diffStatsSummary: {
      additions: files.length * 50,
      deletions: files.length * 50,
      fileCount: files.length,
    },
    headPipeline: { status: 'SUCCESS' },
    labels: { nodes: [] },
    diffHeadSha: 'head-1',
    shouldBeRebased: false,
  }
}

/**
 * Everything GitLab would answer for one merge request of `files`. Only what
 * the queue and the review actually ask for; anything else 404s by name, so an
 * unstubbed call shows up as a readable failure rather than a hang.
 */
async function stubGitLab(page: Page, files: DiffFile[]) {
  const empty = { authored: { nodes: [] }, reviewing: { nodes: [] } }
  await page.context().route(`${GITLAB}/**`, async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, extra: Record<string, string> = {}) =>
      route.fulfill({ status: 200, headers: { ...CORS, ...extra }, json: body })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (url.pathname === '/oauth/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', 'code-1')
      back.searchParams.set('state', url.searchParams.get('state')!)
      return route.fulfill({ status: 302, headers: { location: back.toString() } })
    }
    if (url.pathname === '/oauth/token') {
      return json({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 7200,
        scope: 'api',
        token_type: 'Bearer',
      })
    }
    if (url.pathname === '/api/v4/user') return json({ id: 7, username: 'joao', name: 'Joao' })
    if (url.pathname === '/api/v4/events') return json([])
    if (url.pathname === '/api/graphql') {
      const query = (request.postDataJSON() as { query: string }).query
      if (query.startsWith('query Facts')) {
        return json({
          data: { currentUser: { authored: { nodes: [] }, reviewing: { nodes: [facts(files)] } } },
        })
      }
      if (query.startsWith('query MergedFacts')) return json({ data: { currentUser: empty } })
      if (query.startsWith('query MrOverview')) {
        return json({
          data: {
            project: {
              mergeRequest: {
                iid: String(IID),
                title: 'Diff performance fixture',
                description: 'A merge request far larger than typical.',
                draft: false,
                state: 'opened',
                createdAt: NOW,
                updatedAt: NOW,
                sourceBranch: 'perf',
                targetBranch: 'main',
                webUrl: `${GITLAB}/${PROJECT}/-/merge_requests/${IID}`,
                diffHeadSha: 'head-1',
                commitCount: 3,
                author: person('ana'),
                reviewers: {
                  nodes: [
                    { ...person('joao'), mergeRequestInteraction: { reviewState: 'UNREVIEWED' } },
                  ],
                },
                approvedBy: { nodes: [] },
                approvalsRequired: 1,
                approvalsLeft: 1,
                headPipeline: { status: 'SUCCESS', path: `/${PROJECT}/-/pipelines/1` },
                labels: { nodes: [] },
                diffStatsSummary: {
                  additions: files.length * 50,
                  deletions: files.length * 50,
                  fileCount: files.length,
                },
                shouldBeRebased: false,
                rebaseInProgress: false,
                userPermissions: { pushToSourceBranch: true },
                discussions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
              },
            },
          },
        })
      }
      // RepoMrs, Involved, Watched and Activity all read aliased projects or
      // merge requests; nothing extra needs to exist for this benchmark.
      return json({ data: {} })
    }
    if (url.pathname === MR_PATH) {
      return json({
        iid: IID,
        title: 'Diff performance fixture',
        web_url: `${GITLAB}/${PROJECT}/-/merge_requests/${IID}`,
        state: 'opened',
        source_branch: 'perf',
        target_branch: 'main',
        sha: 'head-1',
      })
    }
    if (url.pathname === `${MR_PATH}/diffs`) return json(files, { 'x-next-page': '' })
    if (url.pathname === `${MR_PATH}/discussions`) return json([], { 'x-next-page': '' })
    return route.fulfill({ status: 404, headers: CORS, json: { message: `unmocked ${url.pathname}` } })
  })
}

/**
 * Records long tasks from the first frame. Each measurement clears the list
 * first, so signing in never lands in the review's numbers.
 */
async function observeLongTasks(page: Page) {
  await page.addInitScript(() => {
    const state = { longTasks: [] as number[] }
    Object.assign(window, { __bench: state })
    new PerformanceObserver((list) => {
      state.longTasks.push(...list.getEntries().map((entry) => entry.duration))
    }).observe({ buffered: true, type: 'longtask' })
  })
}

type Bench = { longTasks: number[] }
const readLongTasks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.longTasks)
const clearLongTasks = (page: Page) =>
  page.evaluate(() => {
    ;(window as unknown as { __bench: Bench }).__bench.longTasks.length = 0
  })

async function signIn(page: Page) {
  await page.goto('/app/')
  await page.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }).click()
  await expect(page.getByRole('complementary', { name: 'Merge requests' })).toBeVisible()
  // First sign-in in a fresh browser: the welcome comes first.
  await page.getByRole('button', { name: 'Start reviewing' }).click()
}

/** Signs in, then opens the Changes tab and waits for the first diff line. */
async function openChanges(page: Page): Promise<number> {
  await signIn(page)
  await clearLongTasks(page)
  const startedAt = Date.now()
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, CHANGES_HASH)
  await page.locator('.diff-line').first().waitFor({ state: 'attached', timeout: 60_000 })
  return Date.now() - startedAt
}

/**
 * The rail is a virtualized tree, so a row only exists once scrolled near.
 * Scan from the top until it mounts; the scan is deliberately outside any
 * measured window.
 */
async function revealRow(page: Page, name: string) {
  const rail = page.locator('.file-list-scroll')
  const row = page.locator('.file-row').filter({ hasText: name }).first()
  await rail.evaluate((element) => {
    element.scrollTop = 0
  })
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if ((await row.count()) > 0) return row
    await rail.evaluate((element) => {
      element.scrollTop += 300
    })
    await page.waitForTimeout(15)
  }
  throw new Error(`row ${name} never appeared in the rail`)
}

test('@benchmark a 50 file review opens highlighted and scrolls without stalling', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const files = makeFiles(50, 100)
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await observeLongTasks(page)
  await stubGitLab(page, files)

  const coldOpenMs = await openChanges(page)
  const loadTasks = await readLongTasks(page)

  // Syntax tokens come back from the worker with the diff, so the first paint
  // is already highlighted instead of arriving plain and upgrading.
  const highlighted = await page
    .locator('.diff-stage[data-diff-ready="true"] .diff-line-syntax-raw')
    .first()
    .count()

  // Reading straight down the stream, the way a review actually goes.
  const main = page.locator('.review-main')
  await clearLongTasks(page)
  await main.hover()
  for (let step = 0; step < 80; step += 1) {
    await page.mouse.wheel(0, 700)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(250)
  const scrollTasks = await readLongTasks(page)

  // Back to a file already built: its bundle is cached, so the switch is a
  // render rather than a build.
  const cachedSwitchMs = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const scroller = document.querySelector<HTMLElement>('.review-main')
        if (!scroller) {
          reject(new Error('Review scroll container is missing'))
          return
        }
        const ready = () =>
          Boolean(scroller.querySelector('.diff-stage[data-diff-ready="true"] .diff-line'))
        const started = performance.now()
        scroller.scrollTop = 0
        if (ready()) {
          requestAnimationFrame(() => resolve(performance.now() - started))
          return
        }
        const observer = new MutationObserver(() => {
          if (!ready()) return
          observer.disconnect()
          requestAnimationFrame(() => resolve(performance.now() - started))
        })
        observer.observe(scroller, { childList: true, subtree: true })
        window.setTimeout(() => {
          observer.disconnect()
          reject(new Error('Cached file did not render'))
        }, 5_000)
      }),
  )

  const report = {
    files: files.length,
    changedLines: files.length * 100,
    coldOpenMs,
    loadBlockingMs: Math.round(loadTasks.reduce((total, task) => total + task, 0)),
    firstPaintHighlighted: highlighted > 0,
    cachedSwitchMs: Math.round(cachedSwitchMs),
    scrollLongTasks: scrollTasks.length,
    scrollLongTaskMaxMs: Math.round(Math.max(0, ...scrollTasks)),
    scrollLongTasksOver100Ms: scrollTasks.filter((task) => task > 100).length,
  }
  console.log('BENCH ' + JSON.stringify(report, null, 2))
  await testInfo.attach('performance.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })

  expect(browserErrors).toEqual([])
  // The worker highlights before the first paint; losing that would make every
  // section mount twice.
  expect(report.firstPaintHighlighted).toBe(true)
  expect(report.cachedSwitchMs).toBeLessThan(100)
  // Reading at a human pace leaves every build between frames: nothing the
  // browser does here should cross the long-task line at all.
  expect(report.scrollLongTasksOver100Ms).toBe(0)
  expect(report.coldOpenMs).toBeLessThan(5_000)
})

test('@benchmark a 300 file review loads, scrolls, and jumps without stalling', async ({ page }, testInfo) => {
  test.setTimeout(300_000)
  const files = makeFiles(300, 120)
  await observeLongTasks(page)
  await stubGitLab(page, files)

  const coldOpenMs = await openChanges(page)
  const loadTasks = await readLongTasks(page)

  const main = page.locator('.review-main')
  await clearLongTasks(page)
  for (let step = 1; step <= 30; step += 1) {
    await main.evaluate((element, index) => {
      element.scrollTop = element.scrollHeight * (index / 40)
    }, step)
    await page.waitForTimeout(40)
  }
  const scrollTasks = await readLongTasks(page)

  // Jumping to a file from the rail.
  const jumpTimes: number[] = []
  for (const fileIndex of [7, 120, 44, 260, 15]) {
    const target = files[fileIndex].new_path.split('/').pop() as string
    const row = await revealRow(page, target)
    const started = Date.now()
    await row.click()
    await page
      .locator(`.diff-line:has-text("new_${fileIndex}_1 ")`)
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 })
    jumpTimes.push(Date.now() - started)
  }

  const renderedSections = await page.locator('.diff-stream-item').count()
  const heapBytes = await page.evaluate(
    () => (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
  )
  const sortedJumps = [...jumpTimes].sort((a, b) => a - b)
  const report = {
    files: files.length,
    payloadMB: +(JSON.stringify(files).length / 1048576).toFixed(2),
    coldOpenMs,
    loadBlockingMs: Math.round(loadTasks.reduce((total, task) => total + task, 0)),
    scrollLongTasks: scrollTasks.length,
    scrollLongTaskMaxMs: Math.round(Math.max(0, ...scrollTasks)),
    jumpMedianMs: sortedJumps[Math.floor(sortedJumps.length / 2)],
    jumpMaxMs: Math.max(...jumpTimes),
    renderedSections,
    heapMB: +(heapBytes / 1048576).toFixed(1),
  }
  console.log('BENCH ' + JSON.stringify(report, null, 2))
  await testInfo.attach('performance.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })

  // Only a window of the review is ever in the DOM.
  expect(report.renderedSections).toBeLessThan(20)
  // Jumping the scroll past hundreds of sections builds the ones it lands on,
  // which is the remaining main-thread cost. This bounds a real regression
  // without failing on the spread between runs.
  expect(report.scrollLongTaskMaxMs).toBeLessThan(400)
  expect(report.jumpMedianMs).toBeLessThan(1_500)
  expect(report.heapMB).toBeLessThan(400)
})
