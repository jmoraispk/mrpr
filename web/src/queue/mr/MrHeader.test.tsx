import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import type { MrOverview } from '../../gitlab/mrOverview'
import type { QueueMr } from '../../gitlab/queueFacts'
import type { InboxItem } from '../../inbox/types'
import { installPlatform } from '../../platform/platform'
import { createFakePlatform } from '../../test/fakePlatform'
import { nudgeText, requestChangesText } from '../commentText'
import type { QueueRow } from '../model'
import { liveBox, richEditor, typeRich } from '../../test/richReply'
import { MrHeader, type HeaderRequest } from './MrHeader'

const transport = vi.hoisted(() => ({
  postComment: vi.fn(async () => ({ id: 'd', notes: [] })),
}))
vi.mock('../../transport/runtime', () => ({ createRuntimeTransport: () => transport }))

const mr = {
  author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
  reviewers: [{ username: 'john', name: 'John', state: 'UNREVIEWED' }],
  labels: [],
  headSha: 'head-9',
} as unknown as QueueMr

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    key: 'h:1',
    hostId: 'h',
    host: 'h',
    mr,
    project: 'g/p',
    iid: 1,
    title: 'Retry budget',
    webUrl: '',
    updatedAt: '2026-10-11T10:00:00Z',
    score: 0,
    tags: [],
    attention: 'needs-you',
    folded: false,
    minutes: 0,
    newCommits: 0,
    items: [],
    snoozed: false,
    done: false,
    involved: true,
    ...over,
  }
}

const waitingReply: InboxItem = {
  id: 'h:7',
  kind: 'reply',
  hostId: 'h',
  mrId: 1,
  project: 'g/p',
  iid: 1,
  mrTitle: '',
  discussionId: 'disc-7',
  noteId: 7,
  author: null,
  excerpt: 'Good now?',
  createdAt: '',
  webUrl: '',
  read: false,
}

const T = { hostId: 'h', project: 'g/p', iid: 1 }
const OVERVIEW = {
  iid: 1,
  title: 'Retry budget',
  description: '',
  draft: false,
  state: 'opened',
  createdAt: '2026-10-09T10:00:00Z',
  updatedAt: '2026-10-11T09:00:00Z',
  sourceBranch: 'retry-budget',
  targetBranch: 'main',
  webUrl: 'https://h/g/p/-/merge_requests/1',
  author: { username: 'ana', name: 'Ana Lima', avatarUrl: null, bot: false },
  reviewers: [{ username: 'john', name: 'John', avatarUrl: null, state: 'UNREVIEWED' }],
  approvalsLeft: 1,
  discussions: [],
} as unknown as MrOverview

let fake: ReturnType<typeof createFakePlatform>
const onApprove = vi.fn()
const onSnooze = vi.fn()
const onReply = vi.fn()

beforeEach(() => {
  transport.postComment.mockClear()
  onApprove.mockClear()
  onSnooze.mockClear()
  onReply.mockClear()
  fake = createFakePlatform()
  installPlatform(fake)
})

function header(
  value: QueueRow | null,
  overview: MrOverview | null = OVERVIEW,
  request: HeaderRequest | null = null,
  onRequestHandled = () => {},
) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MrHeader
        target={T}
        row={value}
        overview={overview ?? undefined}
        full={false}
        fullHref="#/mr/h/g%2Fp/1/full"
        closeHref="#/"
        onApprove={onApprove}
        onSnooze={onSnooze}
        onReply={onReply}
        request={request}
        onRequestHandled={onRequestHandled}
        me="joao"
      />
    </QueryClientProvider>
  )
}
const show = (value: QueueRow | null, overview: MrOverview | null = OVERVIEW) =>
  render(header(value, overview))

test('nudge and request-changes texts tag the right people', () => {
  expect(nudgeText(['john', 'li'])).toBe(
    "@john @li friendly nudge, this one's ready for your review whenever you have a moment.",
  )
  expect(requestChangesText('ana')).toBe('@ana Requesting changes: ')
})

test('the header says who wants to merge what, and links to GitLab', () => {
  show(row())
  expect(screen.getByRole('heading', { name: 'Retry budget' })).toBeInTheDocument()
  expect(screen.getByText(/wants to merge/)).toHaveTextContent(
    'g/p !1 · Ana Lima wants to merge retry-budget → main',
  )
  expect(screen.getByRole('link', { name: 'Open in GitLab ↗' })).toHaveAttribute(
    'href',
    'https://h/g/p/-/merge_requests/1',
  )
  expect(screen.getByRole('link', { name: 'Full screen' })).toHaveAttribute(
    'href',
    '#/mr/h/g%2Fp/1/full',
  )
  expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', '#/')
})

test('request changes opens a composer tagging the author, and posts it', async () => {
  const user = userEvent.setup()
  show(row())
  await user.click(screen.getByRole('button', { name: 'Request changes' }))
  const box = await liveBox('Request changes')
  expect(richEditor(box).getText()).toBe('@ana Requesting changes: ')
  await typeRich(box, 'add the invoice ID to the error')
  expect(screen.getByText('Signed — via Mr. PR')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Post' }))
  expect(transport.postComment).toHaveBeenCalledWith(
    '@ana Requesting changes: add the invoice ID to the error',
  )
})

test('a failed post keeps the text and says so', async () => {
  const user = userEvent.setup()
  transport.postComment.mockRejectedValueOnce(new Error('500'))
  show(row())
  await user.click(screen.getByRole('button', { name: 'Request changes' }))
  const box = await typeRich(await liveBox('Request changes'), 'x')
  await user.click(screen.getByRole('button', { name: 'Post' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't post it")
  expect(richEditor(box).getText()).toBe('@ana Requesting changes: x')
})

test('nudge appears on waiting rows and tags the reviewers still waiting', async () => {
  const user = userEvent.setup()
  show(row({ tags: [{ kind: 'waiting-on-others', days: 0 }] }))
  await user.click(screen.getByRole('button', { name: 'Nudge' }))
  expect(richEditor(await liveBox()).getText()).toBe(
    "@john friendly nudge, this one's ready for your review whenever you have a moment.",
  )
})

test('no nudge outside Waiting on others', () => {
  show(row())
  expect(screen.queryByRole('button', { name: 'Nudge' })).toBeNull()
})

test('r hands the newest waiting thread to the Overview', async () => {
  const older = {
    ...waitingReply,
    id: 'h:6',
    noteId: 6,
    discussionId: 'disc-6',
    createdAt: '2026-10-11T08:00:00Z',
  }
  const newer = { ...waitingReply, createdAt: '2026-10-11T09:00:00Z' }
  render(header(row({ items: [newer, older] }), OVERVIEW, 'reply'))
  await waitFor(() => expect(onReply).toHaveBeenCalledWith('disc-7'))
})

test('nothing waiting on you, nothing to reply to', async () => {
  const handled = vi.fn()
  render(header(row(), OVERVIEW, 'reply', handled))
  await waitFor(() => expect(handled).toHaveBeenCalledOnce())
  expect(onReply).not.toHaveBeenCalled()
})

test('approve and snooze are handed to the queue, which can undo them', async () => {
  const user = userEvent.setup()
  show(row())
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  await user.click(screen.getByRole('button', { name: 'Snooze' }))
  expect(onApprove).toHaveBeenCalledOnce()
  expect(onSnooze).toHaveBeenCalledOnce()
})

test('a key request runs once: x opens request changes', async () => {
  const handled = vi.fn()
  render(header(row(), OVERVIEW, 'changes', handled))
  expect(richEditor(await liveBox('Request changes')).getText()).toBe('@ana Requesting changes: ')
  expect(handled).toHaveBeenCalledOnce()
})

test('without a queue row the header still works from the overview alone', () => {
  show(null)
  expect(screen.getByRole('heading', { name: 'Retry budget' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Snooze' })).toBeNull()
})

test('with neither facts nor an overview, there is nobody to request changes from', () => {
  show(row({ mr: null }), null)
  expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled()
})

test('r finds the thread waiting on you from the MR itself, even once the inbox is read', async () => {
  const withThread = {
    ...OVERVIEW,
    discussions: [
      {
        id: 'd9',
        resolvable: true,
        resolved: false,
        notes: [
          {
            id: 90,
            body: '@joao can you check the retry math?',
            system: false,
            icon: null,
            createdAt: '2026-10-11T08:00:00Z',
            author: { username: 'li', name: 'Li', avatarUrl: null, bot: false },
            position: null,
          },
        ],
      },
    ],
  } as MrOverview
  // The row's inbox items were marked read when the MR opened.
  render(header(row({ items: [{ ...waitingReply, read: true }] }), withThread, 'reply'))
  await waitFor(() => expect(onReply).toHaveBeenCalledWith('d9'))
})

test('the header shows the row’s tags', () => {
  show(row({ tags: [{ kind: 'waiting-on-you' }, { kind: 'changes-addressed' }] }))
  expect(screen.getByText('Changes addressed')).toBeInTheDocument()
  expect(screen.getByText('Waiting on you')).toBeInTheDocument()
})

test('the header says when the MR opened and changed in short form, with the full time on hover', () => {
  show(row())
  const meta = document.querySelector('.mr-meta') as HTMLElement
  expect(meta.textContent).not.toMatch(/ago|just now/)
  const times = [...meta.querySelectorAll('time')]
  expect(times).toHaveLength(2)
  for (const time of times) {
    expect(time.getAttribute('dateTime')).toBeTruthy()
    expect(time.getAttribute('title')).toBeTruthy()
    expect(time.textContent).toMatch(/^(now|\d+(m|h|d|w|mo|y))$/)
  }
})

test('the header has no Move to project and no Reply', () => {
  show(row())
  expect(screen.queryByRole('button', { name: 'Move to project' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
})

test('a merged MR says so beside its title', () => {
  show(row(), { ...OVERVIEW, state: 'merged' } as MrOverview)
  expect(screen.getByText('Merged')).toBeInTheDocument()
})
