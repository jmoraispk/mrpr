import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import type { InboxItem, InboxView } from '../inbox/types'
import { createFakeBrowser } from '../test/fakeBrowser'

const fake = createFakeBrowser() as ReturnType<typeof createFakeBrowser> & {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> }
}
const sent: { op: string; payload?: unknown }[] = []
let hosts: unknown[] = []
let inbox: InboxView
let replyToPollNow: () => Promise<unknown>
fake.runtime = {
  sendMessage: async (message) => {
    const { op, payload } = message as { op: string; payload?: unknown }
    sent.push({ op, payload })
    if (op === 'listHosts') return { ok: true, data: hosts }
    if (op === 'listInbox') return { ok: true, data: inbox }
    if (op === 'pollNow') return replyToPollNow()
    return { ok: true, data: null }
  },
}
vi.mock('webextension-polyfill', () => ({ default: fake }))
await import('../test/installExtensionPlatform')

const { Hub } = await import('./Hub')

const HOST = 'gitlab.example.com'
const ONE_HOST = [{ id: HOST, host: HOST, userId: 7, username: 'joao' }]

function item(n: number, overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: `${HOST}:${n}`,
    kind: 'reply',
    hostId: HOST,
    mrId: 100,
    project: 'g/p',
    iid: 1,
    mrTitle: 'Improve parser errors',
    discussionId: 'd1',
    noteId: n,
    author: { name: 'Ana', username: 'ana', avatarUrl: null },
    excerpt: `note ${n}`,
    createdAt: new Date(Date.now() - n * 60_000).toISOString(),
    webUrl: `https://${HOST}/g/p/-/merge_requests/1#note_${n}`,
    read: false,
    ...overrides,
  }
}

function view(items: InboxItem[], hostError: InboxView['hosts'][number]['error'] = null): InboxView {
  return {
    hosts: [{ hostId: HOST, host: HOST, lastPollAt: new Date().toISOString(), error: hostError }],
    items,
    unread: items.filter((value) => !value.read).length,
    closed: [],
  }
}

function renderHub() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Hub />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fake.reset()
  sent.length = 0
  hosts = ONE_HOST
  inbox = view([])
  replyToPollNow = async () => ({ ok: true, data: inbox })
  window.location.hash = ''
  document.title = 'Mr. PR'
})

test('the hub opens on the inbox, grouped by merge request', async () => {
  inbox = view([
    item(1),
    item(2, { kind: 'mention', mrId: 200, iid: 2, mrTitle: 'Retry the handshake' }),
    item(3, { kind: 'comment', read: true }),
  ])
  renderHub()

  const parser = await screen.findByRole('region', { name: /Improve parser errors/ })
  expect(within(parser).getByText('replied')).toBeInTheDocument()
  expect(within(parser).getByText('note 1')).toBeInTheDocument()
  expect(within(parser).getByText('commented')).toBeInTheDocument()
  const retry = screen.getByRole('region', { name: /Retry the handshake/ })
  expect(within(retry).getByText('mentioned you')).toBeInTheDocument()
  // The group holding the newest item leads.
  expect(
    screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')),
  ).toEqual(['Improve parser errors, 1 unread', 'Retry the handshake, 1 unread'])
})

test('unread rows carry a dot and read rows do not', async () => {
  inbox = view([item(1), item(3, { read: true })])
  renderHub()

  const group = await screen.findByRole('region', { name: /Improve parser errors/ })
  const rows = within(group).getAllByRole('listitem')
  expect(within(rows[0]).getByLabelText('Unread')).toBeInTheDocument()
  expect(within(rows[1]).queryByLabelText('Unread')).toBeNull()
  expect(rows[1]).toHaveClass('is-read')
})

test('the header and the tab title count unread items', async () => {
  inbox = view([item(1), item(2)])
  renderHub()

  const nav = await screen.findByRole('link', { name: /Inbox/ })
  await waitFor(() => expect(nav).toHaveTextContent('2'))
  expect(document.title).toBe('(2) Mr. PR')
})

test('nothing unread leaves the title and the nav plain', async () => {
  inbox = view([item(1, { read: true })])
  renderHub()

  await screen.findByRole('region', { name: /Improve parser errors/ })
  expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument()
  expect(document.title).toBe('Mr. PR')
})

test('opening the hub asks for a catch-up poll', async () => {
  renderHub()

  await waitFor(() =>
    expect(sent).toContainEqual({ op: 'pollNow', payload: { maxAgeMs: 60_000 } }),
  )
})

test('clicking an item marks it read and opens its thread', async () => {
  const user = userEvent.setup()
  inbox = view([item(11)])
  renderHub()

  await user.click(await screen.findByRole('button', { name: /Ana replied/ }))

  expect(sent).toContainEqual({ op: 'markRead', payload: { ids: [`${HOST}:11`] } })
  await waitFor(() =>
    expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fp/1/note/11'),
  )
})

test('mark all read asks the worker to clear everything', async () => {
  const user = userEvent.setup()
  inbox = view([item(1)])
  renderHub()

  await user.click(await screen.findByRole('button', { name: 'Mark all read' }))

  expect(sent).toContainEqual({ op: 'markAllRead', payload: undefined })
})

test('refresh polls right away and shows what it found', async () => {
  const user = userEvent.setup()
  renderHub()
  await screen.findByText(/Nothing needs you/)
  replyToPollNow = async () => ({ ok: true, data: view([item(4, { excerpt: 'fresh news' })]) })

  await user.click(screen.getByRole('button', { name: 'Refresh' }))

  expect(await screen.findByText('fresh news')).toBeInTheDocument()
  expect(sent).toContainEqual({ op: 'pollNow', payload: undefined })
})

test('a failing host is explained in a sentence', async () => {
  inbox = view([item(1)], { code: 'gitlab_authentication_failed', message: '401 Unauthorized' })
  renderHub()

  expect(
    await screen.findByText(/GitLab rejected the credentials Mr. PR holds/),
  ).toBeInTheDocument()
  expect(screen.getByText('401 Unauthorized')).toHaveClass('hub-detail')
  // What was already found stays visible.
  expect(screen.getByText('note 1')).toBeInTheDocument()
})

test('an empty inbox says nothing needs you', async () => {
  renderHub()

  expect(await screen.findByText(/Nothing needs you/)).toBeInTheDocument()
})

test('with no hosts the inbox shows the setup card', async () => {
  hosts = []
  renderHub()

  expect(await screen.findByText(/Add a GitLab host to get started/)).toBeInTheDocument()
})

test('a change to the stored inbox is picked up without a reload', async () => {
  renderHub()
  await screen.findByText(/Nothing needs you/)
  const before = sent.filter((entry) => entry.op === 'listInbox').length
  inbox = view([item(5, { excerpt: 'arrived by alarm' })])

  await fake.storage.local.set({ inbox: { hosts: {} } })

  expect(await screen.findByText('arrived by alarm')).toBeInTheDocument()
  expect(sent.filter((entry) => entry.op === 'listInbox').length).toBeGreaterThan(before)
})
