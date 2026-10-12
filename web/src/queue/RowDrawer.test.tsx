import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import type { QueueMr } from '../gitlab/queueFacts'
import type { InboxItem } from '../inbox/types'
import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import type { QueueRow } from './model'
import { nudgeText, requestChangesText } from './commentText'
import { RowDrawer } from './RowDrawer'

const transport = vi.hoisted(() => ({
  approve: vi.fn(async () => {}),
  unapprove: vi.fn(async () => {}),
  postComment: vi.fn(async () => ({ id: 'd', notes: [] })),
  replyToDiscussion: vi.fn(async () => ({ id: 1, body: '' })),
  markLooked: vi.fn(async () => {}),
}))
vi.mock('../transport/runtime', () => ({ createRuntimeTransport: () => transport }))

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
    bucket: 'needs-you',
    score: 0,
    badges: [],
    items: [],
    snoozed: false,
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

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  Object.values(transport).forEach((fn) => fn.mockClear())
  fake = createFakePlatform()
  installPlatform(fake)
})

const show = (value: QueueRow) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RowDrawer row={value} onClose={() => {}} />
    </QueryClientProvider>,
  )

test('nudge and request-changes texts tag the right people', () => {
  expect(nudgeText(['john', 'li'])).toBe(
    "@john @li friendly nudge, this one's ready for your review whenever you have a moment.",
  )
  expect(requestChangesText('ana')).toBe('@ana Requesting changes: ')
})

test('approve counts as a look, then undo', async () => {
  const user = userEvent.setup()
  show(row())
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(transport.approve).toHaveBeenCalledOnce()
  expect(transport.markLooked).toHaveBeenCalledWith('head-9')
  await user.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(transport.unapprove).toHaveBeenCalledOnce()
})

test('a failed undo says so', async () => {
  const user = userEvent.setup()
  transport.unapprove.mockRejectedValueOnce(new Error('403'))
  show(row())
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  await user.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't undo the approval")
})

test('a failed approval says so and leaves the row as it was', async () => {
  const user = userEvent.setup()
  transport.approve.mockRejectedValueOnce(new Error('403'))
  show(row())
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't approve")
  expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
})

test('request changes opens a composer tagging the author, and posts it', async () => {
  const user = userEvent.setup()
  show(row())
  await user.click(screen.getByRole('button', { name: 'Request changes' }))
  const box = screen.getByRole('textbox')
  expect(box).toHaveValue('@ana Requesting changes: ')
  await user.type(box, 'add the invoice ID to the error')
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
  await user.type(screen.getByRole('textbox'), 'x')
  await user.click(screen.getByRole('button', { name: 'Post' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't post it")
  expect(screen.getByRole('textbox')).toHaveValue('@ana Requesting changes: x')
})

test('nudge appears on waiting rows and tags the reviewers still waiting', async () => {
  const user = userEvent.setup()
  show(row({ bucket: 'waiting' }))
  await user.click(screen.getByRole('button', { name: 'Nudge' }))
  expect(screen.getByRole('textbox')).toHaveValue(
    "@john friendly nudge, this one's ready for your review whenever you have a moment.",
  )
})

test('no nudge outside Waiting on others', () => {
  show(row())
  expect(screen.queryByRole('button', { name: 'Nudge' })).toBeNull()
})

test('reply goes to the thread waiting on you, and marks it read', async () => {
  const user = userEvent.setup()
  show(row({ items: [waitingReply] }))
  expect(screen.getByText('Good now?')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Reply' }))
  await user.type(screen.getByRole('textbox'), 'Yes, ship it')
  await user.click(screen.getByRole('button', { name: 'Post' }))
  expect(transport.replyToDiscussion).toHaveBeenCalledWith('disc-7', 'Yes, ship it')
  await waitFor(() =>
    expect(fake.sent).toContainEqual({ kind: 'delta/hub', op: 'markRead', payload: { ids: ['h:7'] } }),
  )
})

test('snooze hides the row until it changes', async () => {
  const user = userEvent.setup()
  show(row())
  await user.click(screen.getByRole('button', { name: 'Snooze' }))
  await expect(fake.store.get('snoozed')).resolves.toEqual({ 'h:1': '2026-10-11T10:00:00Z' })
})

test('move to a new project pins the MR there', async () => {
  const user = userEvent.setup()
  show(row())
  await user.click(screen.getByRole('button', { name: 'Move to project' }))
  await user.type(screen.getByLabelText('New project'), 'Payments{Enter}')
  await waitFor(async () =>
    expect(await fake.store.get('projects')).toMatchObject([{ name: 'Payments', pinned: ['h:1'] }]),
  )
})
