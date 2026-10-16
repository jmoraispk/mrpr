import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import type { MrOverview } from '../gitlab/mrOverview'
import type { QueueHost, QueueMr } from '../gitlab/queueFacts'
import type { InboxItem } from '../inbox/types'
import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { liveBox, richEditor, typeRich } from '../test/richReply'
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
    state: 'opened',
    mergedAt: null,
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
let repoMrs: QueueMr[] = []
/** When set, All MRs answers only once it resolves. */
let repoGate: Promise<void> | null = null
let fake: ReturnType<typeof createFakePlatform>

beforeEach(() => {
  window.location.hash = ''
  items = []
  repoMrs = []
  repoGate = null
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
      if (message.op === 'listRepoMrs') {
        if (repoGate) await repoGate
        return { ok: true, data: { [H]: structuredClone(repoMrs) } }
      }
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

test('the sidebar says what needs you and the folded bot MRs', async () => {
  renderApp()
  await screen.findAllByRole('article')
  const side = sidebar()!
  expect(within(side).getByText('2 need you')).toBeInTheDocument()
  expect(within(side).queryByText(/min today/)).toBeNull()
  expect(within(side).getByText('1 bot MR folded away')).toBeInTheDocument()
})

test('MRs are grouped by repository, each row without labels', async () => {
  renderApp()
  const rows = await screen.findAllByRole('article')
  expect(rows.map((row) => row.querySelector('.sb-title-text')?.textContent)).toEqual([
    'Retry budget for webhooks',
    'Fix flaky test',
  ])
  expect(screen.getByRole('button', { name: /g\/sdk\s*2 \/ 2/ })).toBeInTheDocument()
  expect(within(rows[0]).getByText(/· Ana ·/)).toBeInTheDocument()
  expect(rows[0].querySelector('.q-tag')).toBeNull()
})

test('your own MRs are under From me', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  await user.click(screen.getByRole('tab', { name: /^From me/ }))
  expect(screen.getAllByRole('article').map((row) => row.querySelector('.sb-title-text')?.textContent)).toEqual([
    'Port billing',
  ])
})

test('a host error shows its sentence and offers to sign in again', async () => {
  hosts = [{ hostId: H, host: H, username: 'joao', mrs: [], error: 'signed_out' }]
  renderApp()
  expect(await screen.findByText(/Your sign-in to this host has ended/)).toBeInTheDocument()
  screen.getByRole('button', { name: 'Sign in again' }).click()
  expect(fake.connectHost).toHaveBeenCalledWith({ host: H, apiBase: `https://${H}/api/v4` })
})

test('one click opens the MR on the right, beside the list', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  await user.click(rowNamed('Fix flaky test'))
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/2')
  const panel = await screen.findByRole('region', { name: 'Fix flaky test' })
  expect(await within(panel).findByText('Adds a retry budget.')).toBeInTheDocument()
  expect(sidebar()).toBeInTheDocument()
  expect(rowNamed('Fix flaky test')).toHaveAttribute('aria-current', 'true')
  expect(selectedText()).toContain('Fix flaky test')
})

test('j moves the selection and a approves the selected row', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'j' })
  fireEvent.keyDown(window, { key: 'a' })
  await waitFor(() => expect(transport.approve).toHaveBeenCalledOnce())
  expect(selectedText()).toContain('Fix flaky test')
})

test('Enter opens the selected row; d opens it since your last review', async () => {
  renderApp()
  await screen.findAllByRole('article')
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

test('opening the queue catches up a stale poll', async () => {
  renderApp()
  await screen.findAllByRole('article')
  expect(fake.sent).toContainEqual({
    kind: 'delta/hub',
    op: 'pollNow',
    payload: { maxAgeMs: 60_000 },
  })
})

test('an approval leaves the MR in To do (nothing is ticked for you), and a failed undo says so', async () => {
  const user = userEvent.setup()
  // GitLab now reports the approval.
  transport.approve.mockImplementationOnce(async () => {
    hosts[0].mrs[0] = { ...hosts[0].mrs[0], reviewers: [{ username: 'joao', name: 'Joao', state: 'APPROVED' }] }
  })
  transport.unapprove.mockRejectedValueOnce(new Error('403'))
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'a' })
  const toast = await screen.findByRole('status')
  expect(toast).toHaveTextContent('Approved Retry budget for webhooks')
  await waitFor(() => expect(transport.approve).toHaveBeenCalled())
  expect(screen.getAllByRole('article').map((row) => row.textContent).join()).toContain('Retry budget')
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't undo the approval")
})

test('Snoozed flips the sidebar to snoozed MRs and Active flips it back; Unsnooze works there', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 's' })
  await waitFor(() => expect(screen.getAllByRole('article')[0]).not.toHaveTextContent('Retry budget'))
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(screen.getAllByRole('article')[0]).toHaveTextContent('Retry budget'))
  fireEvent.keyDown(window, { key: 's' })
  await user.click(await screen.findByRole('button', { name: 'Snoozed (1)' }))
  expect(screen.getByRole('button', { name: /^Active \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('article').map((row) => row.textContent).join()).toContain('Retry budget')
  await user.click(screen.getByRole('button', { name: 'Unsnooze Retry budget for webhooks' }))
  await waitFor(() => expect(screen.getByText('Nothing snoozed.')).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /^Active/ }))
  expect(rowNamed('Retry budget')).toBeInTheDocument()
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

test('x on the list opens the selected MR with request changes started', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'x' })
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  expect(richEditor(await liveBox('Request changes')).getText()).toBe('@ana Requesting changes: ')
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/1')
})

test('x on the open MR starts request changes in its header', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  await waitFor(() => expect(selectedText()).toContain('Retry budget'))
  fireEvent.keyDown(window, { key: 'x' })
  expect(richEditor(await liveBox('Request changes')).getText()).toBe('@ana Requesting changes: ')
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

test('after opening an MR, r still reaches the thread waiting on you', async () => {
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
  await user.click(rowNamed('Retry budget'))
  const panel = await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  // Opening read the mention in the inbox.
  await waitFor(() => expect(items[0].read).toBe(true))
  await waitFor(() => expect(panel.querySelector('.mr-actions')).not.toBeNull())
  await user.keyboard('r')
  await waitFor(() =>
    expect(document.querySelector('[data-discussion-id="d1"] .rich-reply-input')).toHaveFocus(),
  )
})

test('after the selected row leaves the list, j goes on to the next one, not back to the top', async () => {
  // A third MR from someone else, so the list goes on after the one that leaves.
  hosts[0].mrs[2] = {
    ...hosts[0].mrs[2],
    roles: ['reviewer'],
    author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
    reviewers: [{ username: 'joao', name: 'Joao', state: 'UNREVIEWED' }],
  }
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'j' })
  // Snoozing takes it off the list.
  fireEvent.keyDown(window, { key: 's' })
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
  await user.click(screen.getByRole('button', { name: /^g\/web\s*\d/ }))
  fireEvent.keyDown(window, { key: 'j' })
  expect(selectedText()).toContain('Fix flaky test')
})

test('b and Ctrl+B hide and show the sidebar, and it stays as you left it', async () => {
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'b' })
  await waitFor(() => expect(sidebar()).toBeNull())
  await waitFor(async () => expect(await fake.store.get('sidebar')).toEqual({ open: false, width: 400 }))
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
  expect(screen.getByText('Click an MR to open it.')).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(2)
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

test('Settings is a page of its own, with a way back to the MRs', async () => {
  window.location.hash = '#/settings'
  renderApp()
  await waitFor(() => expect(document.querySelector('.q-shell')).toHaveClass('has-page'))
  expect(screen.getByRole('link', { name: '← MRs' })).toHaveAttribute('href', '#/')
})

test('an approval refused for want of posting rights says so', async () => {
  transport.approve.mockRejectedValueOnce(
    Object.assign(new Error('Posting needs your OK in GitLab.'), { code: 'write_access_denied' }),
  )
  renderApp()
  await screen.findAllByRole('article')
  fireEvent.keyDown(window, { key: 'a' })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Couldn't approve Retry budget for webhooks: posting needs your OK in GitLab.",
  )
})

test('the sidebar is as wide as it was left', async () => {
  await fake.store.set({ sidebar: { open: true, width: 480 } })
  renderApp()
  await screen.findAllByRole('article')
  await waitFor(() =>
    expect((document.querySelector('.q-shell') as HTMLElement).style.getPropertyValue('--sidebar-width')).toBe('480px'),
  )
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the sidebar' }), { key: 'ArrowLeft' })
  await waitFor(async () => expect(await fake.store.get('sidebar')).toEqual({ open: true, width: 464 }))
})

test('the 💤 on a row snoozes it without opening it, and Undo brings it back', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  await user.click(screen.getByRole('button', { name: 'Snooze Fix flaky test' }))
  await waitFor(() =>
    expect(screen.getAllByRole('article').map((row) => row.textContent).join()).not.toContain('Fix flaky test'),
  )
  expect(window.location.hash).toBe('')
  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(rowNamed('Fix flaky test')).toBeInTheDocument())
})

test('hiding the sidebar mid-drag drops the drag, and the saved width shows', async () => {
  await fake.store.set({ sidebar: { open: true, width: 400 } })
  renderApp()
  await screen.findAllByRole('article')
  const handle = screen.getByRole('separator', { name: 'Resize the sidebar' })
  fireEvent.pointerDown(handle, { clientX: 400, pointerId: 1, button: 0 })
  fireEvent.pointerMove(handle, { clientX: 520, pointerId: 1 })
  fireEvent.keyDown(window, { key: 'b' })
  fireEvent.keyDown(window, { key: 'b' })
  await screen.findByRole('separator', { name: 'Resize the sidebar' })
  expect((document.querySelector('.q-shell') as HTMLElement).style.getPropertyValue('--sidebar-width')).toBe('400px')
})

test('a muted repository leaves the list and every count, even with its MR open', async () => {
  await fake.store.set({ mutedGroups: { [`repo:${H}:g/sdk`]: 'g/sdk' } })
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/2'
  renderApp()
  expect(await screen.findByRole('region', { name: 'Fix flaky test' })).toBeInTheDocument()
  const side = sidebar()!
  await waitFor(() => expect(within(side).getByText('0 need you')).toBeInTheDocument())
  expect(within(side).queryByRole('article')).toBeNull()
  fireEvent.keyDown(window, { key: 'j' })
  expect(window.location.hash).toBe('#/mr/gitlab.example.com/g%2Fsdk/2')
})

test('muting a repository says so with Undo; Undo brings it back', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  await user.click(screen.getByRole('button', { name: 'Options for g/sdk' }))
  await user.click(screen.getByRole('menuitem', { name: 'Mute repository' }))
  const notice = await screen.findByRole('status')
  expect(notice).toHaveTextContent('Muted g/sdk')
  await waitFor(() => expect(screen.queryByRole('article')).toBeNull())
  await user.click(within(notice).getByRole('button', { name: 'Undo' }))
  expect(await screen.findAllByRole('article')).not.toHaveLength(0)
  await waitFor(async () => expect(await fake.store.get('mutedGroups')).toEqual({}))
})

test('an old Snoozed link opens the snoozed view; muted repositories are groups there with Unmute', async () => {
  const user = userEvent.setup()
  await fake.store.set({ mutedGroups: { ['repo:' + H + ':g/sdk']: 'g/sdk' } })
  window.location.hash = '#/snoozed'
  renderApp()
  await waitFor(() => expect(window.location.hash).toBe('#/'))
  expect(await screen.findByRole('button', { name: /^Active/ })).toHaveAttribute('aria-pressed', 'true')
  const group = await screen.findByRole('region', { name: 'g/sdk' })
  expect(within(group).getByText('muted')).toBeInTheDocument()
  expect(within(group).getAllByRole('article').length).toBeGreaterThan(0)
  await user.click(within(group).getByRole('button', { name: 'Options for g/sdk' }))
  await user.click(screen.getByRole('menuitem', { name: 'Unmute' }))
  await waitFor(async () => expect(await fake.store.get('mutedGroups')).toEqual({}))
})

test('switching views keeps the open MR open and its keys working', async () => {
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/2'
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('region', { name: 'Fix flaky test' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Snoozed/ }))
  expect(screen.getByRole('region', { name: 'Fix flaky test' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'a' })
  await waitFor(() => expect(transport.approve).toHaveBeenCalledOnce())
})

test('with its repository muted, the open MR still answers a', async () => {
  await fake.store.set({ mutedGroups: { ['repo:' + H + ':g/sdk']: 'g/sdk' } })
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/2'
  renderApp()
  expect(await screen.findByRole('region', { name: 'Fix flaky test' })).toBeInTheDocument()
  await waitFor(() => expect(within(sidebar()!).getByText('0 need you')).toBeInTheDocument())
  fireEvent.keyDown(window, { key: 'a' })
  await waitFor(() => expect(transport.approve).toHaveBeenCalledOnce())
})

test('↻ polls GitLab and reads the MRs again now', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findAllByRole('article')
  await user.click(screen.getByRole('button', { name: /^Refresh/ }))
  expect(fake.sent).toContainEqual({ kind: 'delta/hub', op: 'pollNow', payload: { maxAgeMs: 0 } })
  await waitFor(() =>
    expect(fake.sent.filter((message: { op?: string }) => message.op === 'listQueue').length).toBeGreaterThan(1),
  )
})

test('if anything scrolls the page itself, it snaps back to the top', async () => {
  renderApp()
  await screen.findAllByRole('article')
  const root = document.scrollingElement ?? document.documentElement
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(root, 'scrollTop', { configurable: true, value: 120 })
  fireEvent.scroll(window)
  expect(scrollTo).toHaveBeenCalledWith(0, 0)
  Object.defineProperty(root, 'scrollTop', { configurable: true, value: 0 })
  scrollTo.mockRestore()
})

test('a reply survives leaving the MR and coming back at once', async () => {
  const user = userEvent.setup()
  const thread = (replied: boolean) => ({
    id: 'd1', resolvable: true, resolved: false,
    notes: [
      {
        id: 55, body: 'Should the budget reset?', system: false, icon: null,
        createdAt: '2026-10-11T09:00:00Z',
        author: { username: 'li', name: 'Li', avatarUrl: null, bot: false }, position: null,
      },
      ...(replied
        ? [{
            id: 56, body: 'Only on success', system: false, icon: null,
            createdAt: '2026-10-11T10:00:00Z',
            author: { username: 'joao', name: 'Joao', avatarUrl: null, bot: false }, position: null,
          }]
        : []),
    ],
  })
  let replied = false
  transport.replyToDiscussion.mockImplementation(async () => {
    replied = true
    return { id: 56, body: 'Only on success', author: { name: 'Joao', username: 'joao' } }
  })
  transport.getOverview.mockImplementation(async (target: { iid: number }) => ({
    ...overview(target.iid === 1 ? 'Retry budget for webhooks' : 'Fix flaky test'),
    discussions: target.iid === 1 ? [thread(replied)] : [],
  }))
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  renderApp()
  const box = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-discussion-id="d1"] [role="textbox"]')
    expect(found).not.toBeNull()
    return found!
  })
  await typeRich(box, 'Only on success')
  await user.click(
    within(document.querySelector('[data-discussion-id="d1"]') as HTMLElement).getByRole('button', { name: 'Reply' }),
  )
  await waitFor(() => expect(replied).toBe(true))
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/2'
  await screen.findByRole('region', { name: 'Fix flaky test' })
  window.location.hash = '#/mr/gitlab.example.com/g%2Fsdk/1'
  const back = await screen.findByRole('region', { name: 'Retry budget for webhooks' })
  expect(await within(back).findByText('Only on success')).toBeInTheDocument()
})

test('an old Snoozed link replaces itself, so Back does not bring it back', async () => {
  window.location.hash = '#/snoozed'
  const before = history.length
  renderApp()
  await waitFor(() => expect(window.location.hash).toBe('#/'))
  expect(history.length).toBe(before)
})

test('All MRs adds the other open MRs of your repositories once, and only while it is on', async () => {
  const user = userEvent.setup()
  repoMrs = [
    mr(7, {
      title: 'Someone else’s change',
      roles: [],
      reviewers: [],
      author: { username: 'li', name: 'Li', avatarUrl: null, bot: false },
    }),
    mr(2, { title: 'Fix flaky test', roles: [] }),
  ]
  renderApp()
  await screen.findAllByRole('article')
  expect(fake.sent.some((message: { op?: string }) => message.op === 'listRepoMrs')).toBe(false)
  await user.click(screen.getByRole('button', { name: /^Filters/ }))
  await user.click(screen.getByRole('checkbox', { name: 'All MRs' }))
  expect(await screen.findByText('Someone else’s change')).toBeInTheDocument()
  expect(screen.getAllByText('Fix flaky test')).toHaveLength(1)
  expect(rowNamed('Someone else’s change')).not.toHaveClass('is-needs-you')
  await user.click(screen.getByRole('checkbox', { name: 'All MRs' }))
  await waitFor(() => expect(screen.queryByText('Someone else’s change')).toBeNull())
})

test('All MRs rows stay put while the list is read again, even when the repositories change order', async () => {
  const user = userEvent.setup()
  hosts[0].mrs[1] = mr(2, { title: 'Fix flaky test', project: 'g/web', updatedAt: '2026-10-11T08:00:00Z' })
  repoMrs = [
    mr(7, {
      title: 'Someone else’s change',
      roles: [],
      reviewers: [],
      author: { username: 'li', name: 'Li', avatarUrl: null, bot: false },
    }),
  ]
  renderApp()
  await screen.findAllByRole('article')
  await user.click(screen.getByRole('button', { name: /^Filters/ }))
  await user.click(screen.getByRole('checkbox', { name: 'All MRs' }))
  expect(await screen.findByText('Someone else’s change')).toBeInTheDocument()

  // g/web is now the most recently updated repository, and the next read is slow.
  let open = () => {}
  repoGate = new Promise((resolve) => (open = resolve))
  hosts[0].mrs[1] = { ...hosts[0].mrs[1], updatedAt: '2026-10-12T08:00:00Z' }
  await user.click(screen.getByRole('button', { name: /^Refresh/ }))
  await waitFor(() =>
    expect(fake.sent.filter((message: { op?: string }) => message.op === 'listRepoMrs').length).toBeGreaterThan(1),
  )
  expect(screen.getByText('Someone else’s change')).toBeInTheDocument()
  open()
})
