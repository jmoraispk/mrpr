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
// whichever MR asked for it.
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

const mention = (discussionId = 'd'): InboxItem => ({
  id: `${H}:55`, kind: 'mention', hostId: H, mrId: 1, project: 'g/sdk', iid: 1,
  mrTitle: 'Retry budget for webhooks', discussionId, noteId: 55, author: null,
  excerpt: '@joao can you look?', createdAt: '2026-10-11T09:00:00Z', webUrl: '', read: false,
})

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
        // Waiting two days longer: ahead of the quick win in the default order.
        mr(1, { title: 'Retry budget for webhooks', createdAt: '2026-10-09T00:00:00Z' }),
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
      // A fresh copy, as a real hub sends: tests change `hosts` in place.
      if (message.op === 'listQueue') return { ok: true, data: structuredClone(hosts) }
      if (message.op === 'listInbox') {
        return { ok: true, data: { hosts: [], items, unread: items.length } }
      }
      if (message.op === 'listHosts') return { ok: true, data: [] }
      // Like the real hub: reading items updates the stored inbox, and the page re-reads it.
      if (message.op === 'markRead') {
        const { ids } = message.payload as { ids: string[] }
        items = items.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item))
        await fake.store.set({ inbox: Date.now() })
        return { ok: true, data: null }
      }
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

const sidebar = () => screen.queryByRole('complementary', { name: 'Merge requests' })
const rowNamed = (title: string) =>
  screen.getAllByRole('article').find((row) => row.textContent?.includes(title))!
const selectedText = () => document.querySelector('.sb-row.is-selected')?.textContent ?? ''

test('the sidebar says what needs you, today’s budget and the folded bot MRs', async () => {
  renderApp()
  await screen.findAllByRole('article')
  const side = sidebar()!
  expect(within(side).getByText('2 need you')).toBeInTheDocument()
  // 130 lines ≈ 5 min, plus 5 lines ≈ 1 min.
  expect(within(side).getByText('~6 min today')).toBeInTheDocument()
  expect(within(side).getByText('1 bot MR folded away')).toBeInTheDocument()
})

test('MRs are grouped by repository, what needs you first, each with its tags', async () => {
  renderApp()
  const rows = await screen.findAllByRole('article')
  expect(rows.map((row) => row.querySelector('.sb-title-text')?.textContent)).toEqual([
    'Retry budget for webhooks',
    'Fix flaky test',
    'Port billing',
  ])
  expect(screen.getByRole('button', { name: /g\/sdk\s*2 \/ 3/ })).toBeInTheDocument()
  expect(within(rows[0]).getByText('Blocking 1 person')).toBeInTheDocument()
  expect(within(rows[0]).getByText(/by Ana/)).toBeInTheDocument()
  expect(within(rows[1]).getByText('Quick win · ~1 min')).toBeInTheDocument()
  // Days counted from now, so only the name is fixed.
  expect(within(rows[2]).getByText(/^Waiting on John/)).toBeInTheDocument()
})

test('a host error shows its sentence and offers to sign in again', async () => {
  hosts = [{ hostId: H, host: H, username: 'joao', mrs: [], error: 'signed_out' }]
  renderApp()
  expect(await screen.findByText(/Your sign-in to this host has ended/)).toBeInTheDocument()
  screen.getByRole('button', { name: 'Sign in again' }).click()
  expect(fake.connectHost).toHaveBeenCalledWith({ host: H, apiBase: `https://${H}/api/v4` })
})

test('one click expands a row in place, reading nothing; a second folds it', async () => {
  const user = userEvent.setup()
  items = [mention()]
  renderApp()
  await screen.findAllByRole('article')
  await user.click(rowNamed('Retry budget'))
  expect(await within(rowNamed('Retry budget')).findByText('Adds a retry budget.')).toBeInTheDocument()
  expect(window.location.hash).toBe('')
  expect(fake.sent.some((message) => 'op' in message && message.op === 'markRead')).toBe(false)
  expect(transport.markLooked).not.toHaveBeenCalled()
  // A separate click, not the second half of a double-click.
  fireEvent.click(rowNamed('Retry budget'), { detail: 1 })
  expect(within(rowNamed('Retry budget')).queryByText('Adds a retry budget.')).toBeNull()
})

test('a double-click opens the MR on the right, beside the list', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  await user.dblClick(rowNamed('Fix flaky test'))
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/2')
  const panel = await screen.findByRole('region', { name: 'Fix flaky test' })
  expect(await within(panel).findByText('Adds a retry budget.')).toBeInTheDocument()
  expect(sidebar()).toBeInTheDocument()
  expect(rowNamed('Fix flaky test')).toHaveAttribute('aria-current', 'true')
})

test('j moves the selection and a approves the selected row', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'j' })
  fireEvent.keyDown(window, { key: 'a' })
  await waitFor(() => expect(transport.approve).toHaveBeenCalledOnce())
  expect(selectedText()).toContain('Fix flaky test')
})

test('Space expands the selected row; Enter opens it; d opens it since your last review', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: ' ' })
  expect(await within(rowNamed('Retry budget')).findByText('Adds a retry budget.')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'd' })
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1/since')
  window.location.hash = ''
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1')
})

test('? shows every key', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: '?' })
  expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
})

test('opening a review lands on the waiting thread and reads what was folded into its row', async () => {
  items = [mention()]
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

test('dropping a row on a project’s header moves it there', async () => {
  await fake.store.set({
    projects: [
      { id: 'pay', name: 'Payments', color: '#1E4FD8', rules: { repositories: [], labels: [] }, pinned: [`${H}:3`] },
    ],
  })
  renderApp()
  const target = await screen.findByRole('button', { name: /Payments/ })
  const data = new Map<string, string>()
  const dataTransfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
  fireEvent.dragStart(rowNamed('Retry budget'), { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  await waitFor(async () =>
    expect(await fake.store.get('projects')).toMatchObject([{ pinned: [`${H}:3`, `${H}:1`] }]),
  )
})

test('+ Project opens the project form', async () => {
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '+ Project' }))
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

test('an approval outlives its row leaving the list, and a failed undo says so', async () => {
  const user = userEvent.setup()
  // GitLab now reports the approval, so the next fetch makes the row done.
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
    expect(screen.getAllByRole('article').map((row) => row.textContent).join()).not.toContain(
      'Retry budget',
    ),
  )
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't undo the approval")
})

test('a snooze can be undone, and snoozed MRs are listed on their own page', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 's' })
  await waitFor(() =>
    expect(screen.getAllByRole('article')[0]).not.toHaveTextContent('Retry budget'),
  )
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(screen.getAllByRole('article')[0]).toHaveTextContent('Retry budget'))

  fireEvent.keyDown(window, { key: 's' })
  await user.click(await screen.findByRole('link', { name: 'Snoozed (1)' }))
  const page = await screen.findByRole('region', { name: 'Snoozed' })
  expect(within(page).getByRole('link', { name: 'Retry budget for webhooks' })).toBeInTheDocument()
  await user.click(within(page).getByRole('button', { name: 'Unsnooze' }))
  await waitFor(() => expect(within(page).getByText('Nothing snoozed.')).toBeInTheDocument())
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

test('with an MR open, j moves the selection without opening another; Escape closes it', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  await waitFor(() => expect(selectedText()).toContain('Retry budget'))
  fireEvent.keyDown(window, { key: 'j' })
  expect(selectedText()).toContain('Fix flaky test')
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1')
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#/'))
})

test('f goes full screen without the sidebar, and Escape comes back before closing', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  fireEvent.keyDown(window, { key: 'f' })
  await waitFor(() => expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1/full'))
  expect(sidebar()).toBeNull()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1'))
  expect(sidebar()).toBeInTheDocument()
})

test('Escape folds the expanded row before it closes the MR', async () => {
  const user = userEvent.setup()
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  await user.click(rowNamed('Fix flaky test'))
  await within(rowNamed('Fix flaky test')).findByRole('button', { name: 'Open full view' })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(within(rowNamed('Fix flaky test')).queryByRole('button', { name: 'Open full view' })).toBeNull()
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1')
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#/'))
})

test('a review link for an MR not in the list still opens, and j then picks the first row', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fother/77'
  renderApp()
  expect(await screen.findByRole('region', { name: 'An MR' })).toBeInTheDocument()
  await screen.findAllByRole('article')
  expect(selectedText()).toBe('')
  fireEvent.keyDown(window, { key: 'j' })
  expect(selectedText()).toContain('Retry budget')
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fother/77')
})

test('a and s work on the list without opening anything', async () => {
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

test('x on the list starts request changes in the selected row, opening nothing', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'x' })
  const box = await within(rowNamed('Retry budget')).findByRole('textbox', { name: 'Request changes' })
  expect(box).toHaveValue('@ana Requesting changes: ')
  expect(window.location.hash).toBe('')
})

test('x on the open MR starts request changes in its header', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  const panel = await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  await waitFor(() => expect(selectedText()).toContain('Retry budget'))
  fireEvent.keyDown(window, { key: 'x' })
  expect(await within(panel).findByRole('textbox', { name: 'Request changes' })).toHaveValue(
    '@ana Requesting changes: ',
  )
})

test('approving an MR that is not in the queue still works and says so', async () => {
  const user = userEvent.setup()
  window.location.hash = '#/mr/gitlab.example.com/g%2Fother/77'
  renderApp()
  const panel = await screen.findByRole('region', { name: 'An MR' })
  await user.click(await within(panel).findByRole('button', { name: 'Approve' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Approved An MR')
})

test('an MR that needs a rebase offers it in the details column', async () => {
  transport.getOverview.mockImplementation(async () => ({
    ...overview('Retry budget for webhooks'),
    shouldBeRebased: true,
  }))
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  const details = await screen.findByRole('complementary', { name: 'Details' })
  expect(within(details).getByText('Behind main')).toBeInTheDocument()
  expect(within(details).getByRole('button', { name: 'Rebase' })).toBeInTheDocument()
})

test('two quick Escapes leave full screen and then close, even before the screen catches up', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1/full'
  renderApp()
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#/'))
})

test('after opening an MR, Reply still reaches the thread waiting on you', async () => {
  const user = userEvent.setup()
  items = [mention('d1')]
  transport.getOverview.mockImplementation(async () => ({
    ...overview('Retry budget for webhooks'),
    discussions: [
      {
        id: 'd1', resolvable: true, resolved: false,
        notes: [{
          id: 55, body: '@joao can you look?', system: false, icon: null,
          createdAt: '2026-10-11T09:00:00Z',
          author: { username: 'li', name: 'Li', avatarUrl: null, bot: false }, position: null,
        }],
      },
    ],
  }))
  renderApp()
  await screen.findAllByRole('article')
  await user.dblClick(rowNamed('Retry budget'))
  const panel = await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  // Opening read the mention in the inbox.
  await waitFor(() => expect(items[0].read).toBe(true))
  const actions = await waitFor(() => panel.querySelector('.mr-actions') as HTMLElement)
  await user.click(within(actions).getByRole('button', { name: 'Reply' }))
  await waitFor(() =>
    expect(document.querySelector('[data-discussion-id="d1"] textarea')).toHaveFocus(),
  )
})

test('after the selected row leaves the list, j goes on to the next one, not back to the top', async () => {
  transport.approve.mockImplementationOnce(async () => {
    hosts[0].mrs[1] = {
      ...hosts[0].mrs[1],
      reviewers: [{ username: 'joao', name: 'Joao', state: 'APPROVED' }],
    }
  })
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'j' })
  fireEvent.keyDown(window, { key: 'a' })
  await waitFor(() =>
    expect(screen.getAllByRole('article').map((row) => row.textContent).join()).not.toContain(
      'Fix flaky test',
    ),
  )
  fireEvent.keyDown(window, { key: 'j' })
  expect(selectedText()).toContain('Port billing')
})

test('keys never act on a list row while an MR outside the queue is on screen', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'j' }) // picks row 2 on the list
  window.location.hash = '#/mr/gitlab.example.com/g%2Fother/77'
  await screen.findByRole('region', { name: 'An MR' })
  fireEvent.keyDown(window, { key: 'a' })
  fireEvent.keyDown(window, { key: 's' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(transport.approve).not.toHaveBeenCalled()
  expect(document.querySelector('.sb-row.is-selected')).toBeNull()
})

test('keys never act on a row the list hides', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'j' }) // Fix flaky test
  await user.type(screen.getByRole('searchbox', { name: 'Search MRs' }), 'retry')
  fireEvent.keyDown(window, { key: 'a' })
  fireEvent.keyDown(window, { key: 'x' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(transport.approve).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox', { name: 'Request changes' })).toBeNull()
})

test('j skips a folded group', async () => {
  const user = userEvent.setup()
  hosts[0].mrs.push(mr(5, { project: 'g/web', title: 'Web tweak', createdAt: '2026-10-08T00:00:00Z' }))
  renderApp()
  await screen.findAllByRole('article')
  await user.click(screen.getByRole('button', { name: /g\/web/ }))
  fireEvent.keyDown(window, { key: 'j' })
  expect(selectedText()).toContain('Fix flaky test')
})

test('b and Ctrl+B hide and show the sidebar, and it stays as you left it', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'b' })
  await waitFor(() => expect(sidebar()).toBeNull())
  await waitFor(async () => expect(await fake.store.get('sidebar')).toEqual({ open: false }))
  fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
  await waitFor(() => expect(sidebar()).toBeInTheDocument())
})

test('/ focuses the search', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: '/' })
  await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search MRs' })).toHaveFocus())
})

test('nothing open: the right says how to open an MR; an old bucket link lands here', async () => {
  window.location.hash = '#/bucket/waiting'
  renderApp()
  await screen.findAllByRole('article')
  expect(screen.getByText('Double-click an MR to open it.')).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(3)
})

test('in full screen, Escape leaves full screen even with a row expanded behind it', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  await user.dblClick(rowNamed('Fix flaky test'))
  await screen.findByRole('region', { name: 'Fix flaky test' })
  fireEvent.keyDown(window, { key: 'f' })
  await waitFor(() => expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/2/full'))
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/2'))
})

test('with the sidebar hidden, j opens the next MR and keys act on the one on screen', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1/full'
  renderApp()
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  await screen.findAllByRole('article').catch(() => undefined)
  fireEvent.keyDown(window, { key: 'j' })
  await waitFor(() => expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/2/full'))
  await screen.findByRole('region', { name: 'Fix flaky test' })
  fireEvent.keyDown(window, { key: 'a' })
  expect(await screen.findByRole('status')).toHaveTextContent('Approved Fix flaky test')
})

test('the search box takes focus only when asked, not each time the sidebar comes back', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: '/' })
  await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search MRs' })).toHaveFocus())
  fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search MRs' }), { key: 'Escape' })
  fireEvent.keyDown(window, { key: 'b' })
  await waitFor(() => expect(sidebar()).toBeNull())
  fireEvent.keyDown(window, { key: 'b' })
  await waitFor(() => expect(sidebar()).toBeInTheDocument())
  expect(screen.getByRole('searchbox', { name: 'Search MRs' })).not.toHaveFocus()
})

test('Enter in the search box keeps the search and selects the first match', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: '/' })
  const box = screen.getByRole('searchbox', { name: 'Search MRs' })
  await waitFor(() => expect(box).toHaveFocus())
  await user.type(box, 'flaky{Enter}')
  expect(box).not.toHaveFocus()
  expect(box).toHaveValue('flaky')
  expect(selectedText()).toContain('Fix flaky test')
  fireEvent.keyDown(window, { key: 'a' })
  expect(await screen.findByRole('status')).toHaveTextContent('Approved Fix flaky test')
})

test('Settings and Snoozed are pages of their own, with a way back to the MRs', async () => {
  window.location.hash = '#/settings'
  renderApp()
  await waitFor(() => expect(document.querySelector('.q-shell')).toHaveClass('has-page'))
  expect(screen.getByRole('link', { name: '← MRs' })).toHaveAttribute('href', '#/')
})
