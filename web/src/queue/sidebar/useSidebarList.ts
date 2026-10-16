import { useMemo, useState } from 'react'

import {
  arrangeGroups,
  moveGroup as movedOrder,
  shiftGroup as shiftedOrder,
  withMutedGroups,
  useGroupNames,
  useGroupOrder,
} from '../groups'
import { useCollapsedGroups, useListFilters, useListOrder, useListView, useSidebarTab } from '../listSettings'
import type { QueueRow } from '../model'
import {
  filterRows,
  groupRows,
  sortRows,
  type ListFilters,
  type ListOrder,
  type ListView,
  type RowGroup,
  type SidebarTab,
  type SidebarView,
} from '../order'

/** What the sidebar lists, in what order, and the settings that decide it. */
export interface SidebarList {
  groups: RowGroup[]
  /** The rows j and k walk: every listed row outside folded groups, in order. */
  flat: QueueRow[]
  filters: ListFilters
  setFilters: (next: ListFilters) => void
  order: ListOrder
  setOrder: (next: ListOrder) => void
  collapsed: string[]
  toggleGroup: (id: string) => void
  /** Whose MRs are listed, and how many each tab holds with the current search and filters. */
  tab: SidebarTab
  setTab: (next: SidebarTab) => void
  counts: Record<SidebarTab, number>
  /** To do, Done or All, and how many To do and Done hold with the current search and filters. */
  listView: ListView
  setListView: (next: ListView) => void
  viewCounts: Record<'todo' | 'done', number>
  /** Put a group above or below another; the order is kept in this browser. */
  moveGroup: (id: string, target: string, place: 'before' | 'after') => void
  /** Move a group up (-1) or down (1) one place. */
  shiftGroup: (id: string, delta: -1 | 1) => void
  /** Repository group id → its display name in this browser. */
  names: Record<string, string>
  setNames: (next: Record<string, string>) => void
  search: string
  setSearch: (next: string) => void
  /** Whether a search or a filter narrows the list. */
  narrowed: boolean
  /** Clear the search, Needs me only and Hide drafts. Show merged is left as you set it. */
  clear: () => void
}

const NO_MUTED: Record<string, string> = {}

export function useSidebarList(
  rows: QueueRow[],
  /** Whether you opened this MR; keep it stable (useCallback), it is a memo input. */
  isMine: (row: QueueRow) => boolean,
  /** The snoozed view lists snoozed rows and adds the muted repositories' groups. */
  view: SidebarView = 'active',
  muted: Record<string, string> = NO_MUTED,
): SidebarList {
  const [filters, setFilters] = useListFilters()
  const [order, setOrder] = useListOrder()
  const [collapsed, setCollapsed] = useCollapsedGroups()
  const [tab, setTab] = useSidebarTab()
  const [listView, setListView] = useListView()
  const [search, setSearch] = useState('')
  const [groupOrder, setGroupOrder] = useGroupOrder()
  const [names, setNames] = useGroupNames()
  const listed = useMemo(
    () => filterRows(rows, filters, search, view, listView),
    [rows, filters, search, view, listView],
  )
  const viewCounts = useMemo(
    () => ({
      todo: filterRows(rows, filters, search, view, 'todo').length,
      done: filterRows(rows, filters, search, view, 'done').length,
    }),
    [rows, filters, search, view],
  )
  const counts = useMemo(() => {
    const mine = listed.filter(isMine).length
    return { mine, others: listed.length - mine }
  }, [listed, isMine])
  const inTab = useMemo(
    () => listed.filter((row) => isMine(row) === (tab === 'mine')),
    [listed, isMine, tab],
  )
  const groups = useMemo(() => {
    const grouped = groupRows(sortRows(inTab, order))
    return arrangeGroups(view === 'snoozed' ? withMutedGroups(grouped, muted) : grouped, groupOrder, names)
  }, [inTab, order, groupOrder, names, view, muted])
  const listedIds = groups.map((group) => group.id)
  const flat = useMemo(
    () => groups.filter((group) => !collapsed.includes(group.id)).flatMap((group) => group.rows),
    [groups, collapsed],
  )
  return {
    groups,
    flat,
    filters,
    setFilters,
    order,
    setOrder,
    collapsed,
    toggleGroup: (id) =>
      setCollapsed(collapsed.includes(id) ? collapsed.filter((other) => other !== id) : [...collapsed, id]),
    moveGroup: (id, target, place) => setGroupOrder(movedOrder(listedIds, groupOrder, id, target, place)),
    shiftGroup: (id, delta) => setGroupOrder(shiftedOrder(listedIds, groupOrder, id, delta)),
    names,
    setNames,
    tab,
    setTab,
    counts,
    listView,
    setListView,
    viewCounts,
    search,
    setSearch,
    narrowed: search.trim() !== '' || filters.needsMeOnly || filters.hideDrafts,
    clear: () => {
      setSearch('')
      setFilters({ ...filters, needsMeOnly: false, hideDrafts: false })
    },
  }
}
