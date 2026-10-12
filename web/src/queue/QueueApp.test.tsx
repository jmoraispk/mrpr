import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import type { MrOverview } from '../gitlab/mrOverview'
import type { QueueHost, QueueMr } from '../gitlab/queueFacts'
import type { InboxItem } from '../inbox/types'
import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { QueueApp } from './QueueApp'

// Every row action goes through the runtime transport. The overview follows
// whichever MR the panel opened.
const transport = vi.hoisted(() => ({
  approve: vi.fn(async () => {}),
  unapprove: vi.fn(async () => {}),
  postComment: vi.fn(async () => ({ id: 'd', notes: [] })),
  replyToDiscussion: vi.fn(async () => ({ id: 1, body: '' })),
  commitsSince: vi.fn(async () => 0),
  markLooked: vi.fn(async () => {}),
  getOverview: vi.fn(),
}))
vi.mock('../transport/runtime', () => ({
  createRuntimeTransport: (target: { iid: number }) => ({
    ...transport,
    getOverview: () => transport.getOverview(target),
  }),
}))

const H = 'gitlab.example.com'
const JOAO = { username: 'joao', name: 'Joao', avatarUrl: null, bot: false }

function mr(id: number, over: Partial<QueueMr> = {}): QueueMr {
  return {
    id,
    iid: id,
    project: 'g/sdk',
    title: `MR ${id}`,
    webUrl: '',
    createdAt: '2026-10-11T00:00:00Z',
    updatedAt: '2026-10-11T10:00:00Z',
    roles: ['reviewer'],
    draft: false,
    approved: false,
    approvalsLeft: 1,
    author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
    reviewers: [{ username: 'joao', name: 'Joao', state: 'UNREVIEWED' }],
    additions: 120,
    deletions: 10,
    files: 2,
    pipeline: 'SUCCESS',
    labels: [],
    headSha: 'h',
    needsRebase: false,
    ...over,
  }
}


/** The least the MR panel needs to show an MR. */
function overview(title: string): MrOverview {
  return {
    iid: 1, title, description: 'Adds a retry budget.', draft: false, state: 'opened',
    createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T10:00:00Z',
    sourceBranch: 'feature', targetBranch: 'main', webUrl: '', headSha: 'h', commitCount: 1,
    author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
    reviewers: [], approvedBy: [], approvalsRequired: 1, approvalsLeft: 1, pipeline: null,
    labels: [], additions: 1, deletions: 0, files: 1,
    shouldBeRebased: false, rebaseInProgress: false, canPush: true, discussions: [],
  }
}
let hosts: QueueHost[]
let items: InboxItem[] = []
let fake: ReturnType<typeof createFakePlatform>

beforeEach(() => {
  window.location.hash = ''
  items = []
  Object.values(transport).forEach((fn) => fn.mockClear())
  transport.getOverview.mockReset().mockImplementation(async (target: { iid: number }) =>
    overview(hosts[0].mrs.find((value) => value.iid === target.iid)?.title ?? 'An MR'),
  )
  hosts = [
    {
      hostId: H,
      host: H,
      username: 'joao',
      error: null,
      mrs: [
        mr(1, { title: 'Retry budget for webhooks' }),
        mr(2, { title: 'Fix flaky test', additions: 4, deletions: 1 }),
        mr(3, {
          title: 'Port billing',
          roles: ['author'],
          author: JOAO,
          reviewers: [{ username: 'john', name: 'John', state: 'UNREVIEWED' }],
        }),
        mr(4, {
          title: 'Bump eslint',
          author: { username: 'renovate', name: 'Renovate', avatarUrl: null, bot: true },
        }),
      ],
    },
  ]
  fake = createFakePlatform({
    send: async (message) => {
      fake.sent.push(message)
      if (message.kind !== 'delta/hub') return { ok: true, data: null }
      if (message.op === 'listQueue') return { ok: true, data: hosts }
      if (message.op === 'listInbox') {
        return { ok: true, data: { hosts: [], items, unread: items.length } }
      }
      if (message.op === 'listHosts') return { ok: true, data: [] }
      return { ok: true, data: null }
    },
  })
  installPlatform(fake)
})

const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QueueApp />
    </QueryClientProvider>,
  )

test('the sidebar counts each bucket, folded bot MRs and today’s budget', async () => {
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Queue' })
  expect(await within(nav).findByRole('link', { name: /Needs you\s*1/ })).toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: /Quick wins\s*1/ })).toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: /Waiting on others\s*1/ })).toBeInTheDocument()
  expect(within(nav).getByText(/Folded: 1 bot MR/)).toBeInTheDocument()
  // 130 lines ≈ 5 min, plus 5 lines ≈ 1 min.
  expect(within(nav).getByText("Today's budget: ~6 min")).toBeInTheDocument()
})

test('the queue lists rows in bucket order with their badges', async () => {
  renderApp()
  const rows = await screen.findAllByRole('article')
  expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual([
    'Retry budget for webhooks',
    'Fix flaky test',
    'Port billing',
  ])
  expect(within(rows[0]).getByText('by Ana')).toBeInTheDocument()
  expect(screen.queryByText(/Blocking/)).toBeNull()
  expect(within(rows[1]).getByText('Quick win · ~1 min')).toBeInTheDocument()
  expect(within(rows[2]).getByText(/Waiting on John/)).toBeInTheDocument()
})

test('a bucket link filters the list', async () => {
  window.location.hash = '#/bucket/waiting'
  renderApp()
  const rows = await screen.findAllByRole('article')
  expect(rows).toHaveLength(1)
})

test('Unsorted shows every MR no project claims, grouped by bucket, Waiting included', async () => {
  window.location.hash = '#/project/unsorted'
  renderApp()
  await screen.findAllByRole('article')
  const groups = document.querySelectorAll('.q-group')
  expect([...groups].map((group) => group.textContent)).toEqual([
    'Needs you',
    'Quick wins',
    'Waiting on others',
  ])
})

test('a host error shows its sentence and offers to sign in again', async () => {
  hosts = [{ hostId: H, host: H, username: 'joao', mrs: [], error: 'signed_out' }]
  renderApp()
  expect(await screen.findByText(/Your sign-in to this host has ended/)).toBeInTheDocument()
  screen.getByRole('button', { name: 'Sign in again' }).click()
  expect(fake.connectHost).toHaveBeenCalledWith({ host: H, apiBase: `https://${H}/api/v4` })
})

test('j moves the selection and a approves the selected row', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'j' })
  fireEvent.keyDown(window, { key: 'a' })
  await waitFor(() => expect(transport.approve).toHaveBeenCalledOnce())
  expect(document.querySelector('.q-row.is-selected')?.textContent).toContain('Fix flaky test')
})

test('d opens the selected review since your last look; Enter opens it plainly', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'd' })
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1/since')
  window.location.hash = ''
  items = []
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1')
})

test('g w jumps to a bucket and ? shows every key', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'g' })
  fireEvent.keyDown(window, { key: 'w' })
  expect(window.location.hash).toBe('#/bucket/waiting')
  fireEvent.keyDown(window, { key: '?' })
  expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
})

test('opening a review lands on the waiting thread and reads what was folded into its row', async () => {
  items = [
    {
      id: `${H}:55`,
      kind: 'mention',
      hostId: H,
      mrId: 1,
      project: 'g/sdk',
      iid: 1,
      mrTitle: 'Retry budget for webhooks',
      discussionId: 'd',
      noteId: 55,
      author: null,
      excerpt: '@joao can you look?',
      createdAt: '2026-10-11T09:00:00Z',
      webUrl: '',
      read: false,
    },
  ]
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'Enter' })
  await waitFor(() =>
    expect(fake.sent).toContainEqual({
      kind: 'delta/hub',
      op: 'markRead',
      payload: { ids: [`${H}:55`] },
    }),
  )
  // Straight to the thread that was waiting, as the inbox did.
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1/note/55')
})

test('with no projects, one click makes one per repository', async () => {
  const user = userEvent.setup()
  renderApp()
  await user.click(
    await screen.findByRole('button', { name: 'Create one project per repository' }),
  )
  const projects = within(screen.getByRole('navigation', { name: 'Projects' }))
  expect(await projects.findByRole('link', { name: /sdk/ })).toBeInTheDocument()
})

test('dropping a row on a project moves it there', async () => {
  await fake.store.set({
    projects: [
      { id: 'pay', name: 'Payments', color: '#1E4FD8', rules: { repositories: [], labels: [] }, pinned: [] },
    ],
  })
  renderApp()
  const [first] = await screen.findAllByRole('article')
  const target = await screen.findByRole('link', { name: /Payments/ })
  const data = new Map<string, string>()
  const dataTransfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
  fireEvent.dragStart(first, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  await waitFor(async () =>
    expect(await fake.store.get('projects')).toMatchObject([{ pinned: [`${H}:1`] }]),
  )
})

test('+ New project opens the project form', async () => {
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '+ New project' }))
  expect(screen.getByRole('form', { name: 'New project' })).toBeInTheDocument()
})

test('opening the queue catches up a stale poll', async () => {
  renderApp()
  await screen.findAllByRole('article')
  expect(fake.sent).toContainEqual({
    kind: 'delta/hub',
    op: 'pollNow',
    payload: { maxAgeMs: 60_000 },
  })
})

test('one review is singular, and a small MR outside Quick wins is not called one', async () => {
  hosts[0].mrs = [
    mr(1, { title: 'Retry budget for webhooks' }),
    mr(5, {
      title: 'Small, already approved, new comment',
      roles: ['author'],
      author: JOAO,
      additions: 4,
      deletions: 1,
      reviewers: [{ username: 'ana', name: 'Ana', state: 'REQUESTED_CHANGES' }],
    }),
  ]
  renderApp()
  expect(await screen.findByRole('heading', { name: '1 review needs you' })).toBeInTheDocument()
  const returned = (await screen.findAllByRole('article'))[1]
  expect(within(returned).getByText('Small · ~1 min')).toBeInTheDocument()
})

test('an approval outlives its row leaving the list, and a failed undo says so', async () => {
  const user = userEvent.setup()
  // GitLab now reports the approval, so the next fetch moves the row to Done.
  transport.approve.mockImplementationOnce(async () => {
    hosts[0].mrs[0] = { ...hosts[0].mrs[0], reviewers: [{ username: 'joao', name: 'Joao', state: 'APPROVED' }] }
  })
  transport.unapprove.mockRejectedValueOnce(new Error('403'))
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'a' })

  const toast = await screen.findByRole('status')
  expect(toast).toHaveTextContent('Approved Retry budget for webhooks')
  await waitFor(() =>
    expect(screen.queryByRole('article', { name: /Retry budget/ })).toBeNull(),
  )
  expect(screen.getAllByRole('article').map((row) => row.textContent)).not.toContain(
    expect.stringContaining('Retry budget'),
  )
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't undo the approval")
})

test('a snooze can be undone, and snoozed MRs are listed', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 's' })
  await waitFor(() =>
    expect(screen.getAllByRole('article')[0]).not.toHaveTextContent('Retry budget'),
  )
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
  await waitFor(() =>
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('Retry budget'),
  )

  fireEvent.keyDown(window, { key: 's' })
  await user.click(await screen.findByRole('link', { name: /Snoozed\s*1/ }))
  const rows = await screen.findAllByRole('article')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toHaveTextContent('Retry budget')
})

test('approving counts as a look; a failed approval says so and keeps the row', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'a' })
  await waitFor(() => expect(transport.markLooked).toHaveBeenCalledWith('h'))

  transport.approve.mockRejectedValueOnce(new Error('403'))
  fireEvent.keyDown(window, { key: 'j' })
  fireEvent.keyDown(window, { key: 'a' })
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't approve Fix flaky test")
  expect(screen.getAllByRole('article').map((r) => r.textContent).join()).toContain('Fix flaky test')
})

test('one click on a row opens the MR beside the list', async () => {
  const user = userEvent.setup()
  renderApp()
  await user.click((await screen.findAllByRole('article'))[1])
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/2')
  const panel = await screen.findByRole('region', { name: 'Fix flaky test' })
  expect(await within(panel).findByText('Adds a retry budget.')).toBeInTheDocument()
  expect(screen.getAllByRole('article').length).toBeGreaterThan(1)
})

test('j moves to the next MR and the panel follows; Escape closes the panel', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  fireEvent.keyDown(window, { key: 'j' })
  await waitFor(() => expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/2'))
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#/'))
})

test('f goes full screen and Escape comes back before closing', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  fireEvent.keyDown(window, { key: 'f' })
  await waitFor(() =>
    expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1/full'),
  )
  expect(document.querySelector('.q-split')).toHaveClass('is-full')
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1'))
})

test('the panel returns to the list it was opened from', async () => {
  const user = userEvent.setup()
  window.location.hash = '#/bucket/waiting'
  renderApp()
  await user.click(await screen.findByRole('article'))
  await screen.findByRole('region', { name: 'Port billing' })
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#/bucket/waiting'))
})

test('a review link for an MR not in the list still opens', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fother/77'
  renderApp()
  expect(await screen.findByRole('region', { name: 'An MR' })).toBeInTheDocument()
  // With no row for this MR, j starts at the list's first row instead of jumping past it.
  fireEvent.keyDown(window, { key: 'j' })
  await waitFor(() => expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1'))
})

test('a and s still work on the list without opening anything', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'a' })
  await waitFor(() => expect(transport.approve).toHaveBeenCalledOnce())
  expect(window.location.hash).toBe('')
  expect(await screen.findByRole('status')).toHaveTextContent('Approved Retry budget for webhooks')
})

test('approve from the panel header outlives the row moving, and Undo works', async () => {
  const user = userEvent.setup()
  transport.approve.mockImplementationOnce(async () => {
    hosts[0].mrs[0] = {
      ...hosts[0].mrs[0],
      reviewers: [{ username: 'joao', name: 'Joao', state: 'APPROVED' }],
    }
  })
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  const panel = await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  await user.click(within(panel).getByRole('button', { name: 'Approve' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Approved Retry budget for webhooks')
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(transport.unapprove).toHaveBeenCalledOnce())
})

test('x on the list opens the MR with request changes started', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'x' })
  expect(await screen.findByRole('textbox')).toHaveValue('@ana Requesting changes: ')
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1')
})

test('approving an MR that is not in the queue still works and says so', async () => {
  const user = userEvent.setup()
  window.location.hash = '#/mr/gitlab.example.com/g%2Fother/77'
  renderApp()
  const panel = await screen.findByRole('region', { name: 'An MR' })
  await user.click(await within(panel).findByRole('button', { name: 'Approve' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Approved An MR')
})
