import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { createFakeBrowser } from '../test/fakeBrowser'

const fake = createFakeBrowser() as ReturnType<typeof createFakeBrowser> & {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> }
}
let hosts: unknown[] = []
let summaries: unknown[] = []
const EMPTY_INBOX = { hosts: [], items: [], unread: 0 }
let inbox: unknown = EMPTY_INBOX
/** Overridable so a test can make `listMergeRequests` fail or hang. */
let replyToListMergeRequests = async (): Promise<unknown> => ({
  ok: true,
  data: summaries,
})
/** Same, for the query the whole page is gated on. */
let replyToListHosts = async (): Promise<unknown> => ({ ok: true, data: hosts })
fake.runtime = {
  sendMessage: async (message) => {
    const { op } = message as { op: string }
    if (op === 'listHosts') return replyToListHosts()
    if (op === 'listMergeRequests') return replyToListMergeRequests()
    if (op === 'listInbox') return { ok: true, data: inbox }
    return { ok: true, data: null }
  },
}
vi.mock('webextension-polyfill', () => ({ default: fake }))
await import('../test/installExtensionPlatform')

const { Hub } = await import('./Hub')

function renderHub() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Hub />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // What a release build sees, restored per test so the one development-build
  // test below cannot leak its flag into the others.
  vi.stubGlobal('__DELTA_DEV__', false)
  // The existing tests exercise the merge request lists, which moved off the
  // landing page when the inbox arrived.
  window.location.hash = '#/merge-requests'
  hosts = []
  inbox = EMPTY_INBOX
  summaries = []
  replyToListMergeRequests = async () => ({ ok: true, data: summaries })
  replyToListHosts = async () => ({ ok: true, data: hosts })
  fake.reset()
})

const ONE_HOST = [
  { id: 'h', host: 'gitlab.example.com', userId: 7, username: 'j' },
]

test('with no hosts it shows the setup card, not empty lists', async () => {
  renderHub()
  expect(await screen.findByText(/Add a GitLab host/i)).toBeInTheDocument()
})

test('a development build carries the reload button in the header', async () => {
  vi.stubGlobal('__DELTA_DEV__', true)
  const view = renderHub()
  await screen.findByText(/Add a GitLab host/i)

  const meta = view.container.querySelector('.topbar-meta')
  if (!meta) throw new Error('The header rendered no meta slot')
  const reload = within(meta as HTMLElement).getByRole('button', {
    name: /reload extension/i,
  })
  // It leads the meta slot, ahead of the Inbox link.
  expect(reload.nextElementSibling).toHaveTextContent('Inbox')
})

test('a release build leaves the header alone', async () => {
  renderHub()
  await screen.findByText(/Add a GitLab host/i)

  expect(
    screen.queryByRole('button', { name: /reload extension/i }),
  ).toBeNull()
})

test('a failed host load says so instead of claiming there are no hosts', async () => {
  const user = userEvent.setup()
  hosts = ONE_HOST
  replyToListHosts = async () => ({
    ok: false,
    error: {
      code: 'delta_internal_error',
      message: 'Storage read failed',
      status: 500,
    },
  })
  renderHub()

  expect(
    await screen.findByText(/Could not load your GitLab hosts/i),
  ).toBeInTheDocument()
  expect(screen.getByText('Storage read failed')).toBeInTheDocument()
  // The setup card would tell a configured user to start from scratch.
  expect(screen.queryByText(/Add a GitLab host to get started/i)).toBeNull()

  replyToListHosts = async () => ({ ok: true, data: hosts })
  await user.click(screen.getByRole('button', { name: 'Retry' }))

  expect(await screen.findByText('Open by URL')).toBeInTheDocument()
  expect(screen.queryByText(/Could not load your GitLab hosts/i)).toBeNull()
})

test('lists merge requests awaiting review', async () => {
  hosts = [{ id: 'h', host: 'gitlab.example.com', userId: 7, username: 'j' }]
  summaries = [
    {
      hostId: 'h',
      host: 'gitlab.example.com',
      reviewing: {
        items: [
          {
            id: 1,
            iid: 42,
            title: 'Improve parser errors',
            web_url: 'https://gitlab.example.com/g/p/-/merge_requests/42',
            project_id: 1,
            references: { full: 'g/p!42' },
            updated_at: '2026-08-01T10:00:00Z',
            author: { id: 3, username: 'ana', name: 'Ana' },
          },
        ],
        truncated: false,
      },
      authored: { items: [], truncated: false },
    },
  ]
  renderHub()
  expect(await screen.findByText('Improve parser errors')).toBeInTheDocument()
})

test('a truncated list says so', async () => {
  hosts = [{ id: 'h', host: 'gitlab.example.com', userId: 7, username: 'j' }]
  summaries = [
    {
      hostId: 'h',
      host: 'gitlab.example.com',
      reviewing: { items: [], truncated: true },
      authored: { items: [], truncated: false },
    },
  ]
  renderHub()
  expect(await screen.findByText(/showing the first 100/i)).toBeInTheDocument()
})

test('a revoked permission offers to grant it again', async () => {
  hosts = [{ id: 'h', host: 'gitlab.example.com', userId: 7, username: 'j' }]
  summaries = [
    { hostId: 'h', host: 'gitlab.example.com', error: 'permission_missing' },
  ]
  renderHub()
  expect(
    await screen.findByRole('button', { name: /Grant access/i }),
  ).toBeInTheDocument()
})

test('a host that fails to load is reported without hiding the others', async () => {
  hosts = [{ id: 'h', host: 'gitlab.example.com', userId: 7, username: 'j' }]
  summaries = [
    {
      hostId: 'h',
      host: 'gitlab.example.com',
      error: 'gitlab_authentication_failed',
    },
  ]
  renderHub()
  expect(await screen.findByText(/Reconnect gitlab.example.com/i)).toBeInTheDocument()
})

test('a per-host failure reads as a sentence, not a machine code', async () => {
  hosts = ONE_HOST
  summaries = [
    {
      hostId: 'h',
      host: 'gitlab.example.com',
      error: 'gitlab_authentication_failed',
    },
  ]
  renderHub()

  expect(
    await screen.findByText(/GitLab rejected the credentials Delta holds/i),
  ).toBeInTheDocument()
  // The raw code stays available, but not as the sentence the user reads.
  expect(
    screen.getByText('gitlab_authentication_failed'),
  ).toHaveClass('hub-detail')
})

test('a rejected merge request load explains itself and retries', async () => {
  const user = userEvent.setup()
  hosts = ONE_HOST
  summaries = [
    {
      hostId: 'h',
      host: 'gitlab.example.com',
      reviewing: {
        items: [
          {
            id: 1,
            iid: 42,
            title: 'Improve parser errors',
            web_url: 'https://gitlab.example.com/g/p/-/merge_requests/42',
            project_id: 1,
            references: { full: 'g/p!42' },
            updated_at: '2026-08-01T10:00:00Z',
            author: { id: 3, username: 'ana', name: 'Ana' },
          },
        ],
        truncated: false,
      },
      authored: { items: [], truncated: false },
    },
  ]
  replyToListMergeRequests = async () => ({
    ok: false,
    error: { code: 'delta_internal_error', message: 'Storage read failed', status: 500 },
  })
  renderHub()

  expect(
    await screen.findByText(/Could not load your merge requests/i),
  ).toBeInTheDocument()
  expect(screen.getByText('Storage read failed')).toBeInTheDocument()

  replyToListMergeRequests = async () => ({ ok: true, data: summaries })
  await user.click(screen.getByRole('button', { name: 'Retry' }))

  expect(await screen.findByText('Improve parser errors')).toBeInTheDocument()
  expect(
    screen.queryByText(/Could not load your merge requests/i),
  ).not.toBeInTheDocument()
})

test('the page says it is loading rather than flashing empty', async () => {
  hosts = ONE_HOST
  replyToListMergeRequests = () => new Promise<unknown>(() => {})
  renderHub()

  expect(
    await screen.findByText(/Loading merge requests/i),
  ).toBeInTheDocument()
})

function mergeRequest(
  id: number,
  reference: string,
  title: string,
  updated: string,
) {
  return {
    id,
    iid: Number(reference.split('!')[1]),
    title,
    web_url: `https://gitlab.example.com/${reference.replace(
      '!',
      '/-/merge_requests/',
    )}`,
    project_id: 1,
    references: { full: reference },
    updated_at: updated,
    author: { id: 3, username: 'ana', name: 'Ana' },
  }
}

/** One host whose review queue spans several repositories, as a real one does. */
function acrossRepositories() {
  return [
    {
      hostId: 'h',
      host: 'gitlab.example.com',
      reviewing: {
        items: [
          mergeRequest(
            1,
            'gputelecom/aerial_sdk!5606',
            'Widen the SDK ABI',
            '2026-08-01T10:00:00Z',
          ),
          mergeRequest(
            2,
            'gputelecom/aerial-sls!12',
            'Retry the SLS handshake',
            '2026-08-03T10:00:00Z',
          ),
          mergeRequest(
            3,
            'gputelecom/aerial_sdk!5610',
            'Drop the dead SDK flag',
            '2026-08-02T10:00:00Z',
          ),
        ],
        truncated: false,
      },
      authored: { items: [], truncated: false },
    },
  ]
}

/** The rendered group whose heading names `repository`. */
function groupFor(repository: string): HTMLElement {
  const heading = screen.getByText(repository).closest('.hub-group')
  if (!heading) throw new Error(`No group rendered for ${repository}`)
  return heading as HTMLElement
}

test('merge requests sit under the repository they belong to', async () => {
  hosts = ONE_HOST
  summaries = acrossRepositories()
  renderHub()
  await screen.findByText('Widen the SDK ABI')

  const sdk = groupFor('gputelecom/aerial_sdk')
  expect(within(sdk).getByText('Widen the SDK ABI')).toBeInTheDocument()
  expect(within(sdk).getByText('Drop the dead SDK flag')).toBeInTheDocument()
  expect(within(sdk).queryByText('Retry the SLS handshake')).toBeNull()

  const sls = groupFor('gputelecom/aerial-sls')
  expect(within(sls).getByText('Retry the SLS handshake')).toBeInTheDocument()
  expect(within(sls).queryByText('Widen the SDK ABI')).toBeNull()
})

test('a group heading counts the merge requests it holds', async () => {
  hosts = ONE_HOST
  summaries = acrossRepositories()
  renderHub()
  await screen.findByText('Widen the SDK ABI')

  const sdk = groupFor('gputelecom/aerial_sdk')
  expect(within(sdk).getByText('2')).toBeInTheDocument()
  expect(
    within(sdk).getByRole('button', { name: /2 merge requests/ }),
  ).toBeInTheDocument()

  const sls = groupFor('gputelecom/aerial-sls')
  expect(within(sls).getByText('1')).toBeInTheDocument()
  expect(
    within(sls).getByRole('button', { name: /1 merge request$/ }),
  ).toBeInTheDocument()
})

test('the liveliest repository leads, and so does its newest merge request', async () => {
  hosts = ONE_HOST
  summaries = acrossRepositories()
  const view = renderHub()
  await screen.findByText('Widen the SDK ABI')

  // aerial-sls moved on the 3rd, aerial_sdk on the 2nd.
  expect(
    [...view.container.querySelectorAll('.hub-group-name')].map(
      (name) => name.textContent,
    ),
  ).toEqual(['gputelecom/aerial-sls', 'gputelecom/aerial_sdk'])
  expect(
    within(groupFor('gputelecom/aerial_sdk'))
      .getAllByRole('listitem')
      .map((row) => row.querySelector('strong')?.textContent),
  ).toEqual(['Drop the dead SDK flag', 'Widen the SDK ABI'])
})

test('collapsing a group hides its rows, and expanding restores them', async () => {
  const user = userEvent.setup()
  hosts = ONE_HOST
  summaries = acrossRepositories()
  renderHub()
  await screen.findByText('Widen the SDK ABI')

  const toggle = within(groupFor('gputelecom/aerial_sdk')).getByRole('button')
  await user.click(toggle)

  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Widen the SDK ABI')).toBeNull()
  expect(screen.queryByText('Drop the dead SDK flag')).toBeNull()
  // Shut, the group still says what it is and how much is waiting in it.
  expect(
    within(groupFor('gputelecom/aerial_sdk')).getByText('2'),
  ).toBeInTheDocument()
  // And the repositories either side of it are untouched.
  expect(screen.getByText('Retry the SLS handshake')).toBeInTheDocument()

  await user.click(toggle)

  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Widen the SDK ABI')).toBeInTheDocument()
})

test('a group collapsed on an earlier visit comes back collapsed', async () => {
  hosts = ONE_HOST
  summaries = acrossRepositories()
  fake.data.hubCollapsedGroups = { h: ['gputelecom/aerial_sdk'] }
  renderHub()

  expect(
    await screen.findByRole('button', {
      name: /aerial_sdk/,
      expanded: false,
    }),
  ).toBeInTheDocument()
  expect(screen.queryByText('Widen the SDK ABI')).toBeNull()
  expect(screen.getByText('Retry the SLS handshake')).toBeInTheDocument()
})

test('collapsing is stored under its own key, never the worker’s', async () => {
  const user = userEvent.setup()
  hosts = ONE_HOST
  summaries = acrossRepositories()
  fake.data.hosts = ONE_HOST
  fake.data.tokens = { h: 'glpat-secret' }
  renderHub()
  await screen.findByText('Widen the SDK ABI')

  await user.click(within(groupFor('gputelecom/aerial_sdk')).getByRole('button'))

  await waitFor(() =>
    expect(fake.data.hubCollapsedGroups).toEqual({
      h: ['gputelecom/aerial_sdk'],
    }),
  )
  // Tokens belong to the service worker. The page may not rewrite them, and a
  // merged `storage.local.set` must leave them exactly as they were.
  expect(fake.data.tokens).toEqual({ h: 'glpat-secret' })
  expect(fake.data.hosts).toEqual(ONE_HOST)
})

test('the same repository under two hosts collapses independently', async () => {
  const user = userEvent.setup()
  hosts = [
    { id: 'a', host: 'gitlab.example.com', userId: 7, username: 'j' },
    { id: 'b', host: 'gitlab.internal', userId: 7, username: 'j' },
  ]
  summaries = [
    ['a', 'gitlab.example.com', 1, 'Patch the public copy'],
    ['b', 'gitlab.internal', 2, 'Patch the internal copy'],
  ].map(([hostId, host, id, title]) => ({
    hostId,
    host,
    reviewing: {
      items: [
        mergeRequest(
          id as number,
          'group/api!1',
          title as string,
          '2026-08-01T10:00:00Z',
        ),
      ],
      truncated: false,
    },
    authored: { items: [], truncated: false },
  }))
  renderHub()
  await screen.findByText('Patch the public copy')

  const [onHostA] = screen.getAllByRole('button', { name: /group\/api/ })
  await user.click(onHostA)

  expect(screen.queryByText('Patch the public copy')).toBeNull()
  expect(screen.getByText('Patch the internal copy')).toBeInTheDocument()
  await waitFor(() =>
    expect(fake.data.hubCollapsedGroups).toEqual({ a: ['group/api'] }),
  )
})

test('settings offers to re-grant a host whose permission was withdrawn', async () => {
  const user = userEvent.setup()
  hosts = [{ id: 'h', host: 'gitlab.example.com', userId: 7, username: 'j' }]
  window.location.hash = '#/settings'
  renderHub()

  await user.click(await screen.findByRole('button', { name: 'Grant access' }))

  expect(fake.granted.has('https://gitlab.example.com/*')).toBe(true)
})

test('settings refuses a hostname that carries a port', async () => {
  const user = userEvent.setup()
  window.location.hash = '#/settings'
  renderHub()

  await user.type(
    await screen.findByLabelText(/Hostname/i),
    'https://gitlab.example.com:8443/',
  )
  await user.type(await screen.findByLabelText(/token/i), 'glpat-secret')
  await user.click(screen.getByRole('button', { name: 'Add host' }))

  expect(await screen.findByText(/without a port/i)).toBeInTheDocument()
  expect(await screen.findByText(/gitlab\.example\.com/)).toBeInTheDocument()
  expect(fake.granted.size).toBe(0)
})

test('a merge request with unread activity carries a dot', async () => {
  hosts = ONE_HOST
  summaries = acrossRepositories()
  inbox = {
    hosts: [],
    unread: 1,
    items: [
      {
        id: 'h:11',
        kind: 'reply',
        hostId: 'h',
        mrId: 1,
        project: 'gputelecom/aerial_sdk',
        iid: 5606,
        mrTitle: 'Widen the SDK ABI',
        discussionId: 'd',
        noteId: 11,
        author: null,
        excerpt: '',
        createdAt: '2026-08-04T10:00:00Z',
        webUrl: '',
        read: false,
      },
    ],
  }
  renderHub()
  await screen.findByText('Widen the SDK ABI')

  const rows = within(groupFor('gputelecom/aerial_sdk')).getAllByRole('listitem')
  const widen = rows.find((row) => row.textContent?.includes('Widen the SDK ABI'))!
  const drop = rows.find((row) => row.textContent?.includes('Drop the dead SDK flag'))!
  expect(within(widen).getByLabelText('Unread activity')).toBeInTheDocument()
  expect(within(drop).queryByLabelText('Unread activity')).toBeNull()
})

test('settings can show bot comments in the inbox', async () => {
  const user = userEvent.setup()
  hosts = ONE_HOST
  window.location.hash = '#/settings'
  renderHub()

  const toggle = await screen.findByRole('checkbox', {
    name: /Hide comments from bots/i,
  })
  expect(toggle).toBeChecked()

  await user.click(toggle)

  await waitFor(() =>
    expect(fake.data.inboxSettings).toEqual({ hideBots: false }),
  )
  // A page-owned key: the worker's keys are untouched.
  expect(fake.data.tokens).toBeUndefined()
})
