import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { QueueMr } from '../../gitlab/queueFacts'
import { installPlatform } from '../../platform/platform'
import { createFakePlatform } from '../../test/fakePlatform'
import { buildQueue, type QueueRow } from '../model'
import type { RowGroup } from '../order'
import { useMutedGroups } from '../groups'
import type { SidebarView } from '../order'
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
    needsRebase: false, state: 'opened', mergedAt: null, ...over,
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

const isMine = (row: QueueRow) => row.mr?.author.username === 'joao'

/** The sidebar with the selection QueueApp would keep. */
function Harness({
  rows,
  onOpen,
  onSnooze,
  onMute,
  onRefresh,
  activityKey,
  view,
}: {
  rows: QueueRow[]
  onOpen: (row: QueueRow) => void
  onSnooze: (row: QueueRow) => void
  onMute: (group: RowGroup) => void
  onRefresh: () => void
  activityKey: string | null
  view: SidebarView
}) {
  const [muted] = useMutedGroups()
  const list = useSidebarList(rows, isMine, view, muted)
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <Sidebar
      rows={rows}
      list={list}
      loading={false}
      selectedKey={selected}
      openKey={null}
      activityKey={activityKey}
      updatedAt={Date.now()}
      refreshing={false}
      onRefresh={onRefresh}
      onSnoozeRow={onSnooze}
      onMuteGroup={onMute}
      view={view}
      onToggleView={() => {}}
      onUnmuteGroup={() => {}}
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

function show(rows: QueueRow[] = rowsOf(MRS), activityKey: string | null = null, sidebarView: SidebarView = 'active') {
  const onOpen = vi.fn()
  const onSnooze = vi.fn()
  const onMute = vi.fn()
  const onRefresh = vi.fn()
  const view = render(
    <Harness rows={rows} onOpen={onOpen} onSnooze={onSnooze} onMute={onMute} onRefresh={onRefresh} activityKey={activityKey} view={sidebarView} />,
  )
  return { onOpen, onSnooze, onMute, onRefresh, ...view }
}

const filtersButton = () => screen.getByRole('button', { name: /^Filters/ })
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
  expect(within(sidebar).getByRole('button', { name: 'Snoozed (0)' })).toHaveAttribute('aria-pressed', 'false')
  expect(within(sidebar).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings')
})

test('one group per repository, needs-you first, and done hidden', () => {
  show()
  expect(screen.getByRole('button', { name: /g\/sdk\s*2 \/ 2/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /g\/docs\s*1 \/ 1/ })).toBeInTheDocument()
  expect(titles()).toEqual(['Retry budget for webhooks', 'Fix flaky test', 'Docs for the CLI'])
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

test('a row that needs you has the accent bar; one waiting on others does not', async () => {
  const user = userEvent.setup()
  show()
  expect(rowNamed('Retry budget')).toHaveClass('is-needs-you')
  await user.click(screen.getByRole('tab', { name: /^From me/ }))
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
  await user.click(filtersButton())
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
    expect.arrayContaining(['Docs for the CLI', 'Already approved']),
  )
  expect(screen.getByRole('searchbox', { name: 'Search MRs' })).toHaveValue('')
})

test('a group folds and stays folded', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: /^g\/sdk\s*\d/ }))
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
  const button = screen.getByRole('button', { name: 'Snooze Fix flaky test' })
  expect(button.querySelector('svg')).not.toBeNull()
  expect(button.textContent).not.toContain('💤')
  fireEvent.click(button)
  expect(onSnooze).toHaveBeenCalledOnce()
  expect(onSnooze.mock.calls[0][0]).toMatchObject({ iid: 2 })
  expect(onOpen).not.toHaveBeenCalled()
})

test('two tabs: From others first, From me for your own MRs, with counts, and the choice is saved', async () => {
  const user = userEvent.setup()
  show()
  const others = screen.getByRole('tab', { name: 'From others (3)' })
  expect(others).toHaveAttribute('aria-selected', 'true')
  expect(titles()).not.toContain('Port billing')
  await user.click(screen.getByRole('tab', { name: 'From me (1)' }))
  expect(titles()).toEqual(['Port billing'])
  await waitFor(async () => expect(await fake.store.get('sidebarTab')).toBe('mine'))
  // The counts follow the search.
  await user.type(screen.getByRole('searchbox', { name: 'Search MRs' }), 'flaky')
  expect(screen.getByRole('tab', { name: 'From others (1)' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'From me (0)' })).toBeInTheDocument()
})

test('Filters opens under the Sort row, one box per line, and stays open', async () => {
  const user = userEvent.setup()
  show()
  expect(screen.queryByRole('checkbox', { name: 'Needs me only' })).toBeNull()
  await user.click(filtersButton())
  expect(filtersButton()).toHaveAttribute('aria-expanded', 'true')
  for (const name of ['Needs me only', 'Hide drafts', 'Show done', 'Unresolved threads', 'Resolved threads',
    'New commits', 'Bot comments', 'Other activity (labels, assignees, edits)']) {
    expect(screen.getByRole('checkbox', { name })).toBeInTheDocument()
  }
  await waitFor(async () => expect(await fake.store.get('filtersOpen')).toBe(true))
})

test('with an MR open, Activity boxes change that MR, and Apply to all MRs makes them the default', async () => {
  const user = userEvent.setup()
  show(undefined, 'h:g/p!1')
  await user.click(filtersButton())
  expect(screen.getByText('For the open MR')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Apply to all MRs' })).toBeNull()
  await user.click(screen.getByRole('checkbox', { name: 'Bot comments' }))
  await user.click(await screen.findByRole('button', { name: 'Apply to all MRs' }))
  await waitFor(async () =>
    expect(await fake.store.get('activityFilters')).toMatchObject({ defaults: { bots: true }, perMr: {} }),
  )
})

const groupNames = () => screen.getAllByRole('region').map((section) => section.getAttribute('aria-label'))
const dataTransfer = () => {
  const data = new Map<string, string>()
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()]
    },
  }
}

test('Rename… gives a repository a display name; Enter saves once; empty brings the real name back', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'Options for g/sdk' }))
  await user.click(screen.getByRole('menuitem', { name: 'Rename…' }))
  const field = screen.getByRole('textbox', { name: 'Rename g/sdk' })
  await user.clear(field)
  await user.type(field, 'SDK{Enter}')
  expect(screen.getByRole('button', { name: /^SDK\s*\d/ })).toBeInTheDocument()
  await waitFor(async () => expect(await fake.store.get('groupNames')).toEqual({ [`repo:${H}:g/sdk`]: 'SDK' }))
  await user.click(screen.getByRole('button', { name: 'Options for SDK' }))
  await user.click(screen.getByRole('menuitem', { name: 'Rename…' }))
  await user.clear(screen.getByRole('textbox', { name: 'Rename SDK' }))
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: /^g\/sdk\s*\d/ })).toBeInTheDocument()
  await waitFor(async () => expect(await fake.store.get('groupNames')).toEqual({}))
})

test('Move up and Move down reorder groups, and the order is saved', async () => {
  const user = userEvent.setup()
  show()
  expect(groupNames()).toEqual(['g/sdk', 'g/docs'])
  await user.click(screen.getByRole('button', { name: 'Options for g/docs' }))
  await user.click(screen.getByRole('menuitem', { name: 'Move up' }))
  expect(groupNames()).toEqual(['g/docs', 'g/sdk'])
  await waitFor(async () =>
    expect(await fake.store.get('groupOrder')).toEqual([`repo:${H}:g/docs`, `repo:${H}:g/sdk`]),
  )
})

test('dragging a group header onto another moves it there', () => {
  show()
  // jsdom has no DragEvent, so no pointer position: the drop lands below. Above vs below is
  // covered by moveGroup's tests and the end-to-end drag.
  const sdk = screen.getByRole('button', { name: /^g\/sdk\s*\d/ })
  const docsHead = screen.getByRole('button', { name: /^g\/docs\s*\d/ }).closest('h2')!
  const data = dataTransfer()
  fireEvent.dragStart(sdk, { dataTransfer: data })
  fireEvent.dragOver(docsHead, { dataTransfer: data })
  fireEvent.drop(docsHead, { dataTransfer: data })
  expect(groupNames()).toEqual(['g/docs', 'g/sdk'])
})

test('a drag that is not a group or a row does nothing to a header', () => {
  show()
  const sdkHead = screen.getByRole('button', { name: /^g\/sdk\s*\d/ }).closest('h2')!
  const files = { getData: () => '', types: ['Files'] }
  fireEvent.dragOver(sdkHead, { dataTransfer: files })
  fireEvent.drop(sdkHead, { dataTransfer: files })
  expect(groupNames()).toEqual(['g/sdk', 'g/docs'])
})

test('Mute repository asks the app to mute that repository', async () => {
  const user = userEvent.setup()
  const { onMute } = show()
  await user.click(screen.getByRole('button', { name: 'Options for g/docs' }))
  await user.click(screen.getByRole('menuitem', { name: 'Mute repository' }))
  expect(onMute).toHaveBeenCalledWith(expect.objectContaining({ id: `repo:${H}:g/docs`, repo: 'g/docs' }))
})

test('the footer counts snoozed MRs and muted repositories together', async () => {
  await fake.store.set({ mutedGroups: { 'repo:h:g/x': 'g/x' } })
  show()
  expect(await screen.findByRole('button', { name: 'Snoozed (1)' })).toBeInTheDocument()
})

test('a group header refuses a link dragged from another page, and a dropped file never leaves the app', async () => {
  show()
  const docsHead = (await screen.findByRole('button', { name: /^g\/docs\s*\d/ })).closest('h2')!
  const link = { getData: () => 'https://example.com', types: ['text/uri-list', 'text/plain'] }
  // Not cancelled: the browser shows the drop as not allowed here.
  expect(fireEvent.dragOver(docsHead, { dataTransfer: link })).toBe(true)
  const repoHead = screen.getByRole('button', { name: /^g\/sdk\s*\d/ }).closest('h2')!
  const files = { getData: () => '', types: ['Files'] }
  // Cancelled: the browser does not open the file in place of Mr. PR.
  expect(fireEvent.drop(repoHead, { dataTransfer: files })).toBe(false)
  expect(groupNames()).toEqual(['g/sdk', 'g/docs'])
})

test('the refresh button sits in the header, and Sort sits above the tabs', () => {
  const { onRefresh } = show()
  const head = document.querySelector('.sb-head') as HTMLElement
  fireEvent.click(within(head).getByRole('button', { name: /^Refresh/ }))
  expect(onRefresh).toHaveBeenCalledOnce()
  const sort = screen.getByRole('combobox', { name: /^Sort/ })
  const tabs = screen.getByRole('tablist', { name: 'Whose MRs' })
  expect(sort.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('in the snoozed view, a snoozed row offers Unsnooze and nothing snoozed says so', () => {
  const snoozed = rowsOf(MRS).map((row) => (row.iid === 2 ? { ...row, snoozed: true } : row))
  const { onSnooze } = show(snoozed.filter((row) => row.snoozed), null, 'snoozed')
  fireEvent.click(screen.getByRole('button', { name: 'Unsnooze Fix flaky test' }))
  expect(onSnooze).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: /^Active \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true')
})

test('an empty snoozed view says Nothing snoozed.', () => {
  show([], null, 'snoozed')
  expect(screen.getByText('Nothing snoozed.')).toBeInTheDocument()
})

test('the Show boxes: All MRs greys out the other two as ticked', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: /^Filters/ }))
  const authored = screen.getByRole('checkbox', { name: 'Authored by me' })
  const reviewing = screen.getByRole('checkbox', { name: "I'm the reviewer" })
  expect(authored).toBeChecked()
  expect(reviewing).toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'All MRs' }))
  expect(authored).toBeChecked()
  expect(authored).toBeDisabled()
  expect(reviewing).toBeDisabled()
  await waitFor(async () => expect(await fake.store.get('listFilters')).toMatchObject({ allMrs: true }))
})

test('the footer has no + Project', () => {
  show()
  expect(screen.queryByRole('button', { name: '+ Project' })).toBeNull()
})

test('a merged MR says so in its row', async () => {
  await fake.store.set({ listFilters: { showDone: true } })
  show(rowsOf([mr(1, { title: 'Shipped it', state: 'merged', mergedAt: '2026-10-11T09:00:00Z' })]))
  await screen.findByText('Shipped it')
  expect(within(rowNamed('Shipped it')).getByText('Merged')).toHaveClass('sb-chip')
})
