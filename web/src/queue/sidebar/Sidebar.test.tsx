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
function Harness({
  rows,
  onOpen,
  onSnooze,
}: {
  rows: QueueRow[]
  onOpen: (row: QueueRow) => void
  onSnooze: (row: QueueRow) => void
}) {
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
      onSnoozeRow={onSnooze}
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
  const onSnooze = vi.fn()
  const view = render(
    <Harness rows={rows} onOpen={onOpen} onSnooze={onSnooze} />,
  )
  return { onOpen, onSnooze, ...view }
}

const titles = () =>
  screen.getAllByRole('article').map((row) => row.querySelector('.sb-title-text')?.textContent)
const rowNamed = (title: string) =>
  screen.getAllByRole('article').find((row) => row.textContent?.includes(title))!

test('the header counts what needs you; the footer, the rest', () => {
  show()
  const sidebar = screen.getByRole('complementary', { name: 'Merge requests' })
  expect(within(sidebar).getByText('3 need you')).toBeInTheDocument()
  expect(within(sidebar).queryByText(/min today/)).toBeNull()
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

test('a row: its title, then number, author, size and a short time; no labels', () => {
  show()
  const row = rowNamed('Retry budget')
  expect(row).toHaveTextContent(/!1 · Ana · \+120 −10 · \S+$/)
  expect(row.querySelector('time')).toHaveAttribute('dateTime', '2026-10-11T10:00:00Z')
  expect(row.querySelector('time')?.textContent).not.toMatch(/ago/)
  expect(row.querySelector('.q-tag')).toBeNull()
  expect(within(row).queryByText(/Waiting on you|Quick win|Blocking/)).toBeNull()
})

test('a row that needs you has the accent bar; one waiting on others does not', () => {
  show()
  expect(rowNamed('Retry budget')).toHaveClass('is-needs-you')
  expect(rowNamed('Port billing')).not.toHaveClass('is-needs-you')
})

test('one click opens a row', () => {
  const { onOpen } = show()
  fireEvent.click(rowNamed('Fix flaky test'))
  expect(onOpen).toHaveBeenCalledOnce()
  expect(onOpen.mock.calls[0][0]).toMatchObject({ iid: 2 })
  expect(screen.queryByRole('button', { name: 'Open full view' })).toBeNull()
})

test('the sort menu and its direction button reorder each group, and are saved', async () => {
  const user = userEvent.setup()
  show()
  // Only these two, so the test holds whichever tab lists your own MR.
  const two = () =>
    titles().filter((title) => title === 'Fix flaky test' || title === 'Retry budget for webhooks')
  await user.selectOptions(screen.getByRole('combobox', { name: /^Sort/ }), 'Size')
  expect(two()).toEqual(['Fix flaky test', 'Retry budget for webhooks'])
  await user.click(screen.getByRole('button', { name: 'Smallest first' }))
  expect(two()).toEqual(['Retry budget for webhooks', 'Fix flaky test'])
  expect(screen.getByRole('button', { name: 'Largest first' })).toBeInTheDocument()
  await waitFor(async () =>
    expect(await fake.store.get('listOrder')).toEqual({ sortBy: 'size', descending: true }),
  )
  // A new sort starts in its own natural direction.
  await user.selectOptions(screen.getByRole('combobox', { name: /^Sort/ }), 'Last changed')
  expect(screen.getByRole('button', { name: 'Newest first' })).toBeInTheDocument()
})

test('no tag chips above the list', () => {
  show()
  expect(screen.queryByRole('button', { name: /Waiting on you \d/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
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


test('the snooze button snoozes and never opens the row', () => {
  const { onOpen, onSnooze } = show()
  fireEvent.click(screen.getByRole('button', { name: 'Snooze Fix flaky test' }))
  expect(onSnooze).toHaveBeenCalledOnce()
  expect(onSnooze.mock.calls[0][0]).toMatchObject({ iid: 2 })
  expect(onOpen).not.toHaveBeenCalled()
})
