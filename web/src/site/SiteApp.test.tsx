import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { SiteApp } from './SiteApp'

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

test('a build without a GitLab application says how to set one up', async () => {
  renderSite(null, { hosts: [], scopes: 'api' })
  expect(await screen.findByText(/not set up to sign in/i)).toBeInTheDocument()
})

test('signed out, it offers to sign in to each configured host', async () => {
  const user = userEvent.setup()
  renderSite('Sign-in was cancelled on GitLab.')

  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in was cancelled')
  await user.click(screen.getByRole('button', { name: /Sign in with GitLab.*gitlab.example.com/ }))

  expect(fake.connectHost).toHaveBeenCalledWith({
    host: SITE.host,
    apiBase: 'https://gitlab.example.com/api/v4',
  })
})

test('signed in, it is the hub', async () => {
  hosts = [HOST]
  renderSite()
  expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
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
  await screen.findByRole('heading', { name: 'Inbox' })
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
