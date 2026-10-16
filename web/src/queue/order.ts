import type { QueueRow } from './model'

export type SortBy = 'changed' | 'age' | 'size'
export const SORTS: SortBy[] = ['changed', 'age', 'size']
export const SORT_LABELS: Record<SortBy, string> = {
  changed: 'Last changed',
  age: 'Age',
  size: 'Size',
}
/** Which way each sort starts: the newest change, the oldest MR, the smallest diff. */
export const FIRST_DESCENDING: Record<SortBy, boolean> = { changed: true, age: false, size: false }

/** The sort and which way it runs. */
export interface ListOrder {
  sortBy: SortBy
  /** Largest key first: newest for Last changed and Age, largest for Size. */
  descending: boolean
}

export interface ListFilters {
  needsMeOnly: boolean
  hideDrafts: boolean
  showDone: boolean
  /** Which MRs: yours, your reviews, or every open MR in your repositories. */
  authored: boolean
  reviewing: boolean
  allMrs: boolean
}

/** The sidebar's list: what is active, or what you snoozed or muted. */
export type SidebarView = 'active' | 'snoozed'

/** Whose MRs the sidebar lists: yours, or everyone else's. */
export type SidebarTab = 'mine' | 'others'
export const TABS: SidebarTab[] = ['mine', 'others']
export const TAB_LABELS: Record<SidebarTab, string> = { mine: 'From me', others: 'From others' }

/** One repository, with its rows in list order. */
export interface RowGroup {
  id: string
  /** The repository's path. */
  repo: string
  name: string
  rows: QueueRow[]
  needsYou: number
  /** A muted repository's group, in the snoozed view. */
  muted?: boolean
}

const time = (iso: string) => Date.parse(iso) || 0
type Compare = (a: QueueRow, b: QueueRow) => number
const newest: Compare = (a, b) => time(b.updatedAt) - time(a.updatedAt)

// What each sort compares; null when a row has no such value (no size without MR facts).
const SORT_KEY: Record<SortBy, (row: QueueRow) => number | null> = {
  changed: (row) => time(row.updatedAt),
  age: (row) => time(row.mr?.createdAt ?? row.updatedAt),
  size: (row) => (row.mr ? row.mr.additions + row.mr.deletions : null),
}

/** What the ↑/↓ button says about the order now. */
export function directionLabel(order: ListOrder): string {
  if (order.sortBy === 'size') return order.descending ? 'Largest first' : 'Smallest first'
  return order.descending ? 'Newest first' : 'Oldest first'
}

/** Rows by the sort, in its direction; rows without a value last; ties newest first, then by key. */
export function sortRows(rows: QueueRow[], order: ListOrder): QueueRow[] {
  const key = SORT_KEY[order.sortBy]
  const sign = order.descending ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    if (x !== y) {
      if (x === null) return 1
      if (y === null) return -1
      return sign * (x - y)
    }
    return newest(a, b) || a.key.localeCompare(b.key)
  })
}

function haystack(row: QueueRow): string {
  return [row.title, `!${row.iid}`, row.mr?.author.name ?? '', row.mr?.author.username ?? '', row.project]
    .join('\n')
    .toLowerCase()
}

/** What the sidebar lists. Snoozed and bot-authored rows never are. */
export function filterRows(
  rows: QueueRow[],
  filters: ListFilters,
  search: string,
  view: SidebarView = 'active',
): QueueRow[] {
  const query = search.trim().toLowerCase()
  return rows.filter(
    (row) =>
      !row.folded &&
      // The snoozed view lists snoozed MRs whatever their state.
      (view === 'snoozed' ||
        (!row.snoozed && (filters.showDone || row.attention !== 'done' || !row.involved))) &&
      // Which MRs: notification-only rows (no facts) always; with All MRs, every row.
      (filters.allMrs ||
        !row.mr ||
        (filters.authored && row.mr.roles.includes('author')) ||
        (filters.reviewing && row.mr.roles.includes('reviewer'))) &&
      (!filters.needsMeOnly || row.attention === 'needs-you' || row.attention === 'returned') &&
      (!filters.hideDrafts || !row.mr?.draft) &&
      (!query || haystack(row).includes(query)),
  )
}

export const repoGroupId = (row: QueueRow) => `repo:${row.hostId}:${row.project}`

/** One group per repository, ordered by their first row. Rows keep the order they come in. */
export function groupRows(rows: QueueRow[]): RowGroup[] {
  const byRepo = new Map<string, QueueRow[]>()
  for (const row of rows) {
    const id = repoGroupId(row)
    byRepo.set(id, [...(byRepo.get(id) ?? []), row])
  }
  return [...byRepo].map(([id, list]) => ({
    id,
    repo: list[0].project,
    name: list[0].project,
    rows: list,
    needsYou: list.filter((row) => row.attention === 'needs-you').length,
  }))
}
