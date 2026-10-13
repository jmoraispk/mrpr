import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { MrOverview } from '../../gitlab/mrOverview'
import type { QueueMr } from '../../gitlab/queueFacts'
import { installPlatform } from '../../platform/platform'
import { createFakePlatform } from '../../test/fakePlatform'
import { buildQueue, type QueueRow } from '../model'
import { useProjects } from '../state'
import { Sidebar } from './Sidebar'
import { useSidebarList } from './useSidebarList'

const transport = vi.hoisted(() => ({
  getOverview: vi.fn(),
  replyToDiscussion: vi.fn(),
  postComment: vi.fn(),
}))
vi.mock('../../transport/runtime', () => ({ createRuntimeTransport: () => transport }))

const H = 'gitlab.example.com'
const JOAO = { username: 'joao', name: 'Joao', avatarUrl: null, bot: false }
const BOT = { username: 'renovate', name: 'Renovate', avatarUrl: null, bot: true }

function mr(id: number, over: Partial<QueueMr> = {}): QueueMr {
  return {
    id, iid: id, project: 'g/sdk', title: `MR ${id}`, webUrl: '',
    createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T10:00:00Z', roles: ['reviewer'],
    draft: false, approved: false, approvalsLeft: 1,
    author: { username: 'ana', name: 'Ana', avatarUrl: null, bot: false },
    reviewers: [{ username: 'joao', name: 'Joao', state: 'UNREVIEWED' }],
    additions: 120, deletions: 10, files: 2, pipeline: 'SUCCESS', labels: [], headSha: 'h',
    needsRebase: false, ...over,
  }
}

const MRS = [
  mr(1, { title: 'Retry budget for webhooks', createdAt: '2026-10-09T00:00:00Z' }),
  mr(2, { title: 'Fix flaky test', additions: 4, deletions: 1 }),
  mr(3, {
    title: 'Port billing', roles: ['author'], author: JOAO, additions: 40, deletions: 8,
    reviewers: [{ username: 'john', name: 'John', state: 'UNREVIEWED' }],
    pipeline: 'FAILED', needsRebase: true, labels: ['ai'],
  }),
  mr(4, { title: 'Bump eslint', author: BOT }),
  mr(5, { title: 'Already approved', reviewers: [{ username: 'joao', name: 'Joao', state: 'APPROVED' }] }),
  mr(6, { title: 'Docs for the CLI', project: 'g/docs', draft: true }),
]

const rowsOf = (mrs: QueueMr[]): QueueRow[] =>
  buildQueue({
    hosts: [{ hostId: H, host: H, username: 'joao', mrs, error: null }],
    items: [], snoozed: {}, commitsSince: {}, now: new Date('2026-10-11T12:00:00Z'),
  })

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

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
  transport.getOverview.mockReset().mockImplementation(async () => overview('An MR'))
})

/** The sidebar with the selection and expansion QueueApp would keep. */
function Harness({ rows, onOpen }: { rows: QueueRow[]; onOpen: (row: QueueRow) => void }) {
  const [projects] = useProjects()
  const list = useSidebarList(rows, projects)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <Sidebar
      rows={rows}
      list={list}
      loading={false}
      meFor={() => 'joao'}
      selectedKey={selected}
      expandedKey={expanded}
      openKey={null}
      onToggleRow={(row) => {
        setSelected(row.key)
        setExpanded((key) => (key === row.key ? null : row.key))
      }}
      onOpenRow={onOpen}
      onApprove={vi.fn()}
      onSnooze={vi.fn()}
      previewRequest={null}
      onPreviewRequestHandled={() => {}}
      searchFocus={0}
    />
  )
}

function show(rows: QueueRow[] = rowsOf(MRS)) {
  const onOpen = vi.fn()
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness rows={rows} onOpen={onOpen} />
    </QueryClientProvider>,
  )
  return { onOpen, ...view }
}

const titles = () =>
  screen.getAllByRole('article').map((row) => row.querySelector('.sb-title-text')?.textContent)
const rowNamed = (title: string) =>
  screen.getAllByRole('article').find((row) => row.textContent?.includes(title))!

test('the header counts what needs you and today’s budget; the footer, the rest', () => {
  show()
  const sidebar = screen.getByRole('complementary', { name: 'Merge requests' })
  expect(within(sidebar).getByText('3 need you')).toBeInTheDocument()
  // 130 lines ≈ 5 min, 5 lines ≈ 1 min, the draft's 130 lines ≈ 5 min.
  expect(within(sidebar).getByText('~11 min today')).toBeInTheDocument()
  expect(within(sidebar).getByText('1 bot MR folded away')).toBeInTheDocument()
  expect(within(sidebar).getByRole('link', { name: 'Snoozed (0)' })).toHaveAttribute('href', '#/snoozed')
  expect(within(sidebar).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings')
})

test('one group per repository, needs-you first, and done hidden', () => {
  show()
  expect(screen.getByRole('button', { name: /g\/sdk\s*2 \/ 3/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /g\/docs\s*1 \/ 1/ })).toBeInTheDocument()
  expect(titles()).toEqual([
    'Retry budget for webhooks',
    'Fix flaky test',
    'Port billing',
    'Docs for the CLI',
  ])
})

test('a row: its title, three tags then +N, and a grey line', () => {
  show()
  const billing = rowNamed('Port billing')
  expect(within(billing).getByText('Waiting on John')).toBeInTheDocument()
  expect(within(billing).getByText('Pipeline failed')).toBeInTheDocument()
  expect(within(billing).getByText('Needs rebase')).toBeInTheDocument()
  expect(within(billing).queryByText('AI-authored')).toBeNull()
  expect(within(billing).getByText('+1')).toBeInTheDocument()
  expect(rowNamed('Retry budget')).toHaveTextContent(/!1 · by Ana · \+120 −10 ·/)
})

test('one click expands a row in place; a second folds it', async () => {
  const { onOpen } = show()
  fireEvent.click(rowNamed('Retry budget'), { detail: 1 })
  expect(await within(rowNamed('Retry budget')).findByText('Adds a retry budget.')).toBeInTheDocument()
  fireEvent.click(rowNamed('Retry budget'), { detail: 1 })
  expect(within(rowNamed('Retry budget')).queryByText('Adds a retry budget.')).toBeNull()
  expect(onOpen).not.toHaveBeenCalled()
})

test('a double-click opens the row once and leaves it expanded', async () => {
  const { onOpen } = show()
  const row = rowNamed('Retry budget')
  fireEvent.click(row, { detail: 1 })
  fireEvent.click(row, { detail: 2 })
  fireEvent.dblClick(row)
  expect(onOpen).toHaveBeenCalledOnce()
  expect(onOpen.mock.calls[0][0]).toMatchObject({ iid: 1 })
  expect(await within(rowNamed('Retry budget')).findByText('Adds a retry budget.')).toBeInTheDocument()
})

test('clicks inside the preview never fold the row', async () => {
  const user = userEvent.setup()
  const { onOpen } = show()
  await user.click(rowNamed('Retry budget'))
  await user.click(await within(rowNamed('Retry budget')).findByRole('button', { name: 'Request changes' }))
  const box = within(rowNamed('Retry budget')).getByRole('textbox', { name: 'Request changes' })
  await user.dblClick(box)
  await user.type(box, 'ok')
  expect(within(rowNamed('Retry budget')).getByText('Adds a retry budget.')).toBeInTheDocument()
  expect(onOpen).not.toHaveBeenCalled()
})

test('a chip puts its tag first, numbered, and the order is saved', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: /Waiting on others/ }))
  expect(titles().slice(0, 3)).toEqual(['Port billing', 'Retry budget for webhooks', 'Fix flaky test'])
  const chip = screen.getByRole('button', { name: /Waiting on others/ })
  expect(chip).toHaveAttribute('aria-pressed', 'true')
  expect(chip).toHaveTextContent(/^1/)
  await waitFor(async () =>
    expect(await fake.store.get('listOrder')).toEqual({ tags: ['waiting-on'], sortBy: 'waiting' }),
  )
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  expect(titles()[0]).toBe('Retry budget for webhooks')
})

test('the sort menu reorders each group', async () => {
  const user = userEvent.setup()
  show()
  await user.selectOptions(screen.getByRole('combobox', { name: /^Sort/ }), 'Smallest first')
  expect(titles().slice(0, 3)).toEqual(['Fix flaky test', 'Port billing', 'Retry budget for webhooks'])
})

test('filters: needs me only, hide drafts, show done, search, and clearing them', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('checkbox', { name: 'Show done' }))
  expect(titles()).toContain('Already approved')
  await user.click(screen.getByRole('checkbox', { name: 'Needs me only' }))
  expect(titles()).not.toContain('Port billing')
  expect(titles()).not.toContain('Already approved')
  await user.click(screen.getByRole('checkbox', { name: 'Hide drafts' }))
  expect(titles()).not.toContain('Docs for the CLI')
  await user.type(screen.getByRole('searchbox', { name: 'Search MRs' }), 'zzz')
  expect(screen.getByText(/No MRs match/)).toBeInTheDocument()
  // Clearing keeps Show done: it is a preference, not a narrowing.
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(titles()).toEqual(
    expect.arrayContaining(['Port billing', 'Docs for the CLI', 'Already approved']),
  )
  expect(screen.getByRole('searchbox', { name: 'Search MRs' })).toHaveValue('')
})

test('a group folds and stays folded', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: /g\/sdk/ }))
  expect(titles()).toEqual(['Docs for the CLI'])
  await waitFor(async () =>
    expect(await fake.store.get('collapsedGroups')).toEqual([`repo:${H}:g/sdk`]),
  )
})

test('nothing at all, and nothing but done', async () => {
  const user = userEvent.setup()
  const { unmount } = show([])
  expect(screen.getByText('Nothing waiting on you.')).toBeInTheDocument()
  unmount()
  show(rowsOf([MRS[4]]))
  await user.click(screen.getByRole('button', { name: 'Show 1 done' }))
  expect(titles()).toEqual(['Already approved'])
})
