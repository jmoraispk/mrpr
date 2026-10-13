import type { QueueRow } from './model'
import { projectOf, type Project } from './projects'
import { TAG_PRIORITY, tagText, type TagKind } from './tags'

export type SortBy = 'waiting' | 'updated' | 'oldest' | 'smallest'
export const SORTS: SortBy[] = ['waiting', 'updated', 'oldest', 'smallest']
export const SORT_LABELS: Record<SortBy, string> = {
  waiting: "Who's waiting on you",
  updated: 'Recently updated',
  oldest: 'Oldest first',
  smallest: 'Smallest first',
}

/** Tags to put first, in order, and the sort for everything after them. */
export interface ListOrder {
  tags: TagKind[]
  sortBy: SortBy
}

export interface ListFilters {
  needsMeOnly: boolean
  hideDrafts: boolean
  showDone: boolean
}

/** One project, or one repository no project claims, with its rows in list order. */
export interface RowGroup {
  id: string
  /** The project these rows belong to; null for a repository's group. */
  projectId: string | null
  name: string
  color: string | null
  rows: QueueRow[]
  needsYou: number
}

export interface TagChip {
  kind: TagKind
  count: number
  /** Its place in your tag order, from 1; null when not chosen. */
  position: number | null
}

const ATTENTION_RANK = { 'needs-you': 0, returned: 1, waiting: 2, done: 3 } as const
const time = (iso: string) => Date.parse(iso) || 0
const created = (row: QueueRow) => time(row.mr?.createdAt ?? row.updatedAt)
// Rows without facts have no size: they go last when smallest comes first.
const size = (row: QueueRow) =>
  row.mr ? row.mr.additions + row.mr.deletions : Number.MAX_SAFE_INTEGER

type Compare = (a: QueueRow, b: QueueRow) => number
const newest: Compare = (a, b) => time(b.updatedAt) - time(a.updatedAt)

const SORT_COMPARE: Record<SortBy, Compare> = {
  waiting: (a, b) =>
    ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention] || b.score - a.score || newest(a, b),
  updated: newest,
  oldest: (a, b) => created(a) - created(b) || newest(a, b),
  smallest: (a, b) => size(a) - size(b) || newest(a, b),
}

/** Rows with your first chosen tag, then your second, …, then the rest; each part by the sort. */
export function sortRows(rows: QueueRow[], order: ListOrder): QueueRow[] {
  const place = (row: QueueRow) => {
    const index = order.tags.findIndex((kind) => row.tags.some((tag) => tag.kind === kind))
    return index < 0 ? order.tags.length : index
  }
  const compare = SORT_COMPARE[order.sortBy]
  return [...rows].sort((a, b) => place(a) - place(b) || compare(a, b) || a.key.localeCompare(b.key))
}

function haystack(row: QueueRow): string {
  return [
    row.title,
    `!${row.iid}`,
    row.mr?.author.name ?? '',
    row.mr?.author.username ?? '',
    row.project,
    ...row.tags.map(tagText),
  ]
    .join('\n')
    .toLowerCase()
}

/** What the sidebar lists. Snoozed and bot-authored rows never are. */
export function filterRows(rows: QueueRow[], filters: ListFilters, search: string): QueueRow[] {
  const query = search.trim().toLowerCase()
  return rows.filter(
    (row) =>
      !row.folded &&
      !row.snoozed &&
      (filters.showDone || row.attention !== 'done') &&
      (!filters.needsMeOnly || row.attention === 'needs-you' || row.attention === 'returned') &&
      (!filters.hideDrafts || !row.mr?.draft) &&
      (!query || haystack(row).includes(query)),
  )
}

export const repoGroupId = (row: QueueRow) => `repo:${row.hostId}:${row.project}`

/**
 * Your projects in your order, then one group per repository no project
 * claims, ordered by their first row. Rows keep the order they come in.
 */
export function groupRows(rows: QueueRow[], projects: Project[]): RowGroup[] {
  const byProject = new Map<string, QueueRow[]>()
  const byRepo = new Map<string, QueueRow[]>()
  for (const row of rows) {
    const project = projectOf(row, projects)
    const map = project ? byProject : byRepo
    const id = project ? project.id : repoGroupId(row)
    map.set(id, [...(map.get(id) ?? []), row])
  }
  const group = (
    id: string,
    projectId: string | null,
    name: string,
    color: string | null,
    list: QueueRow[],
  ): RowGroup => ({
    id,
    projectId,
    name,
    color,
    rows: list,
    needsYou: list.filter((row) => row.attention === 'needs-you').length,
  })
  const groups: RowGroup[] = []
  for (const project of projects) {
    const list = byProject.get(project.id)
    if (list?.length) groups.push(group(project.id, project.id, project.name, project.color, list))
  }
  for (const [id, list] of byRepo) groups.push(group(id, null, list[0].project, null, list))
  return groups
}

/** One chip per tag on a listed row, and every chosen tag, chosen ones first. */
export function tagChips(rows: QueueRow[], chosen: TagKind[]): TagChip[] {
  const counts = new Map<TagKind, number>()
  for (const row of rows) {
    for (const kind of new Set(row.tags.map((tag) => tag.kind))) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
  }
  return [
    ...chosen.map((kind, index) => ({ kind, count: counts.get(kind) ?? 0, position: index + 1 })),
    ...TAG_PRIORITY.filter((kind) => !chosen.includes(kind) && counts.has(kind)).map((kind) => ({
      kind,
      count: counts.get(kind)!,
      position: null,
    })),
  ]
}
