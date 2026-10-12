import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { QueueHost, QueueMr } from '../gitlab/queueFacts'
import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { QueueApp } from './QueueApp'

// Every row action goes through the runtime transport.
const transport = vi.hoisted(() => ({
  approve: vi.fn(async () => {}),
  unapprove: vi.fn(async () => {}),
  postComment: vi.fn(async () => ({ id: 'd', notes: [] })),
  replyToDiscussion: vi.fn(async () => ({ id: 1, body: '' })),
  commitsSince: vi.fn(async () => 0),
  markLooked: vi.fn(async () => {}),
}))
vi.mock('../transport/runtime', () => ({ createRuntimeTransport: () => transport }))

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
    ...over,
  }
}

let hosts: QueueHost[]
let fake: ReturnType<typeof createFakePlatform>

beforeEach(() => {
  window.location.hash = ''
  Object.values(transport).forEach((fn) => fn.mockClear())
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
      if (message.kind !== 'delta/hub') return { ok: true, data: null }
      if (message.op === 'listQueue') return { ok: true, data: hosts }
      if (message.op === 'listInbox') {
        return { ok: true, data: { hosts: [], items: [], unread: 0 } }
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
  expect(within(rows[0]).getByText('Blocking 1 person')).toBeInTheDocument()
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
