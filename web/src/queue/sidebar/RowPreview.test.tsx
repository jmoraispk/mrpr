import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import type { MrOverview } from '../../gitlab/mrOverview'
import type { QueueMr } from '../../gitlab/queueFacts'
import type { InboxItem } from '../../inbox/types'
import { installPlatform } from '../../platform/platform'
import { createFakePlatform } from '../../test/fakePlatform'
import { buildQueue, type QueueRow } from '../model'
import type { HeaderRequest } from '../mr/MrHeader'
import { RowPreview } from './RowPreview'

const transport = vi.hoisted(() => ({
  getOverview: vi.fn(),
  replyToDiscussion: vi.fn(async () => ({ id: 1, body: '' })),
  postComment: vi.fn(async () => ({ id: 'd', notes: [] })),
}))
vi.mock('../../transport/runtime', () => ({ createRuntimeTransport: () => transport }))

const H = 'gitlab.example.com'
const JOAO = { username: 'joao', name: 'Joao', avatarUrl: null, bot: false }

function mr(over: Partial<QueueMr> = {}): QueueMr {
  return {
    id: 1, iid: 1, project: 'g/sdk', title: 'Retry budget for webhooks', webUrl: '',
    createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T10:00:00Z', roles: ['reviewer'],
    draft: false, approved: false, approvalsLeft: 1,
    author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
    reviewers: [{ username: 'joao', name: 'Joao', state: 'UNREVIEWED' }],
    additions: 120, deletions: 10, files: 2, pipeline: 'SUCCESS', labels: [], headSha: 'h',
    needsRebase: false, ...over,
  }
}

const mention: InboxItem = {
  id: `${H}:55`, kind: 'mention', hostId: H, mrId: 1, project: 'g/sdk', iid: 1,
  mrTitle: 'Retry budget for webhooks', discussionId: 'd1', noteId: 55, author: null,
  excerpt: '@joao can you look?', createdAt: '2026-10-11T09:00:00Z', webUrl: '', read: false,
}

function rowOf(facts: QueueMr, items: InboxItem[] = []): QueueRow {
  return buildQueue({
    hosts: [{ hostId: H, host: H, username: 'joao', mrs: [facts], error: null }],
    items, snoozed: {}, commitsSince: {}, now: new Date('2026-10-11T12:00:00Z'),
  })[0]
}

function overview(over: Partial<MrOverview> = {}): MrOverview {
  return {
    iid: 1, title: 'Retry budget for webhooks', description: 'Adds a retry budget.', draft: false,
    state: 'opened', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T10:00:00Z',
    sourceBranch: 'feature', targetBranch: 'main', webUrl: '', headSha: 'h', commitCount: 1,
    author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
    reviewers: [], approvedBy: [], approvalsRequired: 1, approvalsLeft: 1, pipeline: null,
    labels: [], additions: 1, deletions: 0, files: 1,
    shouldBeRebased: false, rebaseInProgress: false, canPush: true,
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
    ...over,
  }
}

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
  Object.values(transport).forEach((fn) => fn.mockClear())
  transport.getOverview.mockReset().mockImplementation(async () => overview())
})

function show(
  row: QueueRow,
  over: { request?: HeaderRequest | null; onRequestHandled?: () => void } = {},
) {
  const props = {
    onApprove: vi.fn(),
    onSnooze: vi.fn(),
    onOpen: vi.fn(),
    onRequestHandled: over.onRequestHandled ?? vi.fn(),
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RowPreview row={row} me="joao" order={[]} request={over.request ?? null} {...props} />
    </QueryClientProvider>,
  )
  return props
}

test('the expanded row: every tag, the description, and the comment waiting on you', async () => {
  show(rowOf(mr(), [mention]))
  expect(screen.getByText('Blocking 1 person')).toBeInTheDocument()
  expect(screen.getByText('Reply waiting')).toBeInTheDocument()
  expect(await screen.findByText('Adds a retry budget.')).toBeInTheDocument()
  const waiting = screen.getByRole('region', { name: 'Waiting on you' })
  expect(waiting).toHaveTextContent('Li')
  expect(waiting).toHaveTextContent('@joao can you look?')
})

test('reply inline: posts to the thread, reads the row, and closes the box', async () => {
  const user = userEvent.setup()
  show(rowOf(mr(), [mention]))
  // Reply is off until the MR says which thread waits on you.
  await screen.findByText('Adds a retry budget.')
  await user.click(screen.getByRole('button', { name: 'Reply' }))
  await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Looking now')
  await user.click(screen.getByRole('button', { name: 'Post' }))
  await waitFor(() => expect(transport.replyToDiscussion).toHaveBeenCalledWith('d1', 'Looking now'))
  await waitFor(() =>
    expect(fake.sent).toContainEqual({
      kind: 'delta/hub',
      op: 'markRead',
      payload: { ids: [`${H}:55`] },
    }),
  )
  expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull()
})

test('nothing waiting on you: Reply is off', async () => {
  transport.getOverview.mockImplementation(async () => overview({ discussions: [] }))
  show(rowOf(mr()))
  await screen.findByText('Adds a retry budget.')
  expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled()
})

test('request changes tags the author and posts a comment', async () => {
  const user = userEvent.setup()
  show(rowOf(mr()))
  await user.click(screen.getByRole('button', { name: 'Request changes' }))
  const box = screen.getByRole('textbox', { name: 'Request changes' })
  expect(box).toHaveValue('@ana Requesting changes: ')
  await user.type(box, 'rename it')
  await user.click(screen.getByRole('button', { name: 'Post' }))
  await waitFor(() =>
    expect(transport.postComment).toHaveBeenCalledWith('@ana Requesting changes: rename it'),
  )
})

test('nudge only on your MR waiting on others, tagging who is still to review', async () => {
  const user = userEvent.setup()
  show(
    rowOf(
      mr({
        roles: ['author'],
        author: JOAO,
        reviewers: [{ username: 'john', name: 'John', state: 'UNREVIEWED' }],
      }),
    ),
  )
  await user.click(screen.getByRole('button', { name: 'Nudge' }))
  expect(screen.getByRole('textbox', { name: 'Nudge' })).toHaveValue(
    "@john friendly nudge, this one's ready for your review whenever you have a moment.",
  )
})

test('no nudge on an MR that is not yours', () => {
  show(rowOf(mr()))
  expect(screen.queryByRole('button', { name: 'Nudge' })).toBeNull()
})

test('approve, snooze, move and open', async () => {
  const user = userEvent.setup()
  const row = rowOf(mr())
  const props = show(row)
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  await user.click(screen.getByRole('button', { name: 'Snooze' }))
  await user.click(screen.getByRole('button', { name: 'Open full view' }))
  expect(props.onApprove).toHaveBeenCalledWith(row)
  expect(props.onSnooze).toHaveBeenCalledWith(row)
  expect(props.onOpen).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'Move' }))
  expect(screen.getByRole('group', { name: 'Move to project' })).toBeInTheDocument()
})

test('an overview that fails says so, and the actions still work', async () => {
  const user = userEvent.setup()
  transport.getOverview.mockRejectedValue(new Error('boom'))
  const props = show(rowOf(mr()))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load details")
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(props.onApprove).toHaveBeenCalledOnce()
  transport.getOverview.mockImplementation(async () => overview())
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Adds a retry budget.')).toBeInTheDocument()
})

test('a reply asked for from the keyboard waits for the MR, then opens the box once', async () => {
  const onRequestHandled = vi.fn()
  show(rowOf(mr(), [mention]), { request: 'reply', onRequestHandled })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveFocus())
  expect(onRequestHandled).toHaveBeenCalledOnce()
})
