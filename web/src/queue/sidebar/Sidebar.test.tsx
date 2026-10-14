import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { QueueMr } from '../../gitlab/queueFacts'
import { installPlatform } from '../../platform/platform'
import { createFakePlatform } from '../../test/fakePlatform'
import { buildQueue, type QueueRow } from '../model'
import { useProjects } from '../state'
import { Sidebar } from './Sidebar'
import { useSidebarList } from './useSidebarList'

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

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
})

/** The sidebar with the selection QueueApp would keep. */
function Harness({ rows, onOpen }: { rows: QueueRow[]; onOpen: (row: QueueRow) => void }) {
  const [projects] = useProjects()
  const list = useSidebarList(rows, projects)
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <Sidebar
      rows={rows}
      list={list}
      loading={false}
      selectedKey={selected}
      openKey={null}
      onOpenRow={(row) => {
        setSelected(row.key)
        onOpen(row)
      }}
      width={360}
      onResize={() => {}}
      onResizeEnd={() => {}}
      searchFocus={0}
      onSearchFocused={() => {}}
      onSearchDone={() => {}}
    />
  )
}

function show(rows: QueueRow[] = rowsOf(MRS)) {
  const onOpen = vi.fn()
  const view = render(
    <Harness rows={rows} onOpen={onOpen} />,
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

test('a row: its title, three labels then +N, and a grey line', () => {
  // Your own small MR that you also review, with changes requested and behind its target: five labels.
  const busy = mr(9, {
    title: 'Busy one',
    roles: ['author', 'reviewer'],
    author: JOAO,
    additions: 4,
    deletions: 1,
    needsRebase: true,
    reviewers: [
      { username: 'joao', name: 'Joao', state: 'UNREVIEWED' },
      { username: 'ana', name: 'Ana', state: 'REQUESTED_CHANGES' },
    ],
  })
  show(rowsOf([MRS[0], busy]))
  const row = rowNamed('Busy one')
  expect(within(row).getByText('Blocking 1 person')).toBeInTheDocument()
  expect(within(row).getByText('Returned to you')).toBeInTheDocument()
  expect(within(row).getByText('Quick win · ~1 min')).toBeInTheDocument()
  expect(within(row).queryByText(/Waiting on others/)).toBeNull()
  expect(within(row).getByText('+2')).toBeInTheDocument()
  expect(rowNamed('Retry budget')).toHaveTextContent(/!1 · by Ana · \+120 −10 ·/)
})

test('one click opens a row', () => {
  const { onOpen } = show()
  fireEvent.click(rowNamed('Fix flaky test'))
  expect(onOpen).toHaveBeenCalledOnce()
  expect(onOpen.mock.calls[0][0]).toMatchObject({ iid: 2 })
  expect(screen.queryByRole('button', { name: 'Open full view' })).toBeNull()
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
    expect(await fake.store.get('listOrder')).toEqual({ tags: ['waiting-on-others'], sortBy: 'waiting' }),
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

