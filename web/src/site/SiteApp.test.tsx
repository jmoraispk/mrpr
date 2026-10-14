import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { server } from '../test/server'
import { FULL_SCOPE_KEY, PENDING_KEY } from './auth'
import { SiteApp } from './SiteApp'

const signIn = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./auth', async (original) => ({ ...(await original<object>()), signIn }))

const schedule = vi.hoisted(() => ({
  stop: vi.fn(),
  startPageSchedule: vi.fn(),
  lockedPoll: vi.fn(),
}))
vi.mock('../inbox/pageSchedule', () => ({
  startPageSchedule: (...args: unknown[]) => {
    schedule.startPageSchedule(...args)
    return schedule.stop
  },
  lockedPoll: schedule.lockedPoll,
}))

const SITE = { host: 'gitlab.example.com', clientId: 'client-1' }
const HOST = {
  id: SITE.host,
  host: SITE.host,
  apiBase: 'https://gitlab.example.com/api/v4',
  userId: 7,
  username: 'joao',
}
const EMPTY_INBOX = { hosts: [], items: [], unread: 0 }

let hosts: unknown[]
let inbox: unknown
let fake: ReturnType<typeof createFakePlatform>

beforeEach(() => {
  signIn.mockClear()
  hosts = []
  inbox = EMPTY_INBOX
  window.location.hash = ''
  schedule.startPageSchedule.mockClear()
  schedule.stop.mockClear()
  fake = createFakePlatform({
    send: async (message) => {
      fake.sent.push(message)
      if (message.kind === 'delta/hub' && message.op === 'listHosts') return { ok: true, data: hosts }
      if (message.kind === 'delta/hub' && message.op === 'listInbox') return { ok: true, data: inbox }
      if (message.kind === 'delta/hub' && message.op === 'listQueue') return { ok: true, data: [] }
      return { ok: true, data: null }
    },
  })
  installPlatform(fake)
})

function renderSite(notice: string | null = null, config = { hosts: [SITE], scopes: 'api' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SiteApp config={config} notice={notice} />
    </QueryClientProvider>,
  )
}

test('signed out, it offers to sign in to each configured host', async () => {
  const user = userEvent.setup()
  renderSite('Sign-in was cancelled on GitLab.')

  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in was cancelled')
  await user.click(screen.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }))

  expect(signIn).toHaveBeenCalledWith(SITE, expect.any(String), 'api')
})

test('signed in, it is the review queue', async () => {
  hosts = [HOST]
  renderSite()
  expect(await screen.findByRole('complementary', { name: 'Merge requests' })).toBeInTheDocument()
})

test('a signed-out host offers to sign in again', async () => {
  const user = userEvent.setup()
  hosts = [HOST]
  inbox = {
    hosts: [{ hostId: SITE.host, host: SITE.host, lastPollAt: null, error: { code: 'signed_out', message: 'x' } }],
    items: [],
    unread: 0,
  }
  renderSite()

  await user.click(await screen.findByRole('button', { name: 'Sign in again' }))

  expect(fake.connectHost).toHaveBeenCalledWith({
    host: SITE.host,
    apiBase: 'https://gitlab.example.com/api/v4',
  })
})

test('the page schedule runs only while signed in', async () => {
  renderSite()
  await screen.findByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ })
  expect(schedule.startPageSchedule).not.toHaveBeenCalled()

  hosts = [HOST]
  const view = renderSite()
  await screen.findByRole('complementary', { name: 'Merge requests' })
  expect(schedule.startPageSchedule).toHaveBeenCalledWith({ poll: schedule.lockedPoll })

  view.unmount()
  expect(schedule.stop).toHaveBeenCalled()
})

test('the product is called Mr. PR', async () => {
  renderSite()
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Mr. PR')
})

test('the sign-in page links home and says where the data goes', async () => {
  renderSite()

  expect(await screen.findByRole('link', { name: /Back to Mr\. PR/ })).toHaveAttribute('href', '../')
  expect(
    screen.getByText(
      'Your browser talks to GitLab directly. This site never sees your token or your merge requests.',
    ),
  ).toBeInTheDocument()
})

test('with no built-in server, the link field is still there', async () => {
  renderSite(null, { hosts: [], scopes: 'api' })
  expect(await screen.findByLabelText('Paste a link to any merge request')).toBeInTheDocument()
})

test('a pasted link to a known server signs straight in', async () => {
  const user = userEvent.setup()
  renderSite()
  await user.type(
    await screen.findByLabelText('Paste a link to any merge request'),
    'https://gitlab.example.com/g/p/-/merge_requests/1',
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(signIn).toHaveBeenCalledWith(SITE, expect.any(String), 'api'),
  )
})

test('a pasted link to an unknown server opens the setup', async () => {
  const user = userEvent.setup()
  server.use(http.get('/api/registry/', () => HttpResponse.json({ error: 'unknown' }, { status: 404 })))
  renderSite()
  await user.type(
    await screen.findByLabelText('Paste a link to any merge request'),
    'https://gitlab.other.org/g/p/-/merge_requests/1',
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Congratulations')
})

test('a bad link explains itself', async () => {
  const user = userEvent.setup()
  renderSite()
  await user.type(await screen.findByLabelText('Paste a link to any merge request'), 'hello')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Paste a link to a merge request')
})

test('a built-in server is not copied into this browser', async () => {
  const user = userEvent.setup()
  renderSite()
  await user.type(
    await screen.findByLabelText('Paste a link to any merge request'),
    'https://gitlab.example.com/g/p/-/merge_requests/1',
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(signIn).toHaveBeenCalled())

  // A copy would outlive a rotated build id and could never be fixed.
  await expect(fake.store.get('customHosts')).resolves.toBeUndefined()
})

test('a directory that is down still leads to the setup, without claiming first', async () => {
  const user = userEvent.setup()
  server.use(http.get('/api/registry/', () => HttpResponse.json({ error: 'x' }, { status: 503 })))
  renderSite()
  await user.type(
    await screen.findByLabelText('Paste a link to any merge request'),
    'https://gitlab.other.org/g/p/-/merge_requests/1',
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Set up Mr. PR for')
})

test('back from GitLab without signing in, read-only: it offers full access', async () => {
  const user = userEvent.setup()
  // A read-only sign-in that never came back: GitLab showed its own error page.
  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ host: SITE.host, clientId: SITE.clientId, state: 's', verifier: 'v', returnTo: '#/', scope: 'read_api' }),
  )
  renderSite(null, { hosts: [SITE], scopes: 'read_api' })
  await user.click(await screen.findByRole('button', { name: 'sign in with full access' }))
  expect(signIn).toHaveBeenCalledWith(SITE, expect.any(String), 'api')
  await expect(fake.store.get(FULL_SCOPE_KEY)).resolves.toEqual([SITE.host])
  sessionStorage.clear()
})

test('no unfinished sign-in, no offer', async () => {
  renderSite(null, { hosts: [SITE], scopes: 'read_api' })
  await screen.findByRole('button', { name: /Sign in with GitLab/ })
  expect(screen.queryByRole('button', { name: 'sign in with full access' })).toBeNull()
})
