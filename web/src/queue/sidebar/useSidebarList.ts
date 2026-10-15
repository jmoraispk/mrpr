import { useMemo, useState } from 'react'

import { useCollapsedGroups, useListFilters, useListOrder } from '../listSettings'
import type { QueueRow } from '../model'
import {
  filterRows,
  groupRows,
  sortRows,
  type ListFilters,
  type ListOrder,
  type RowGroup,
} from '../order'
import type { Project } from '../projects'

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
  search: string
  setSearch: (next: string) => void
  /** Whether a search or a filter narrows the list. */
  narrowed: boolean
  /** Clear the search, Needs me only and Hide drafts. Show done is left as you set it. */
  clear: () => void
}

export function useSidebarList(rows: QueueRow[], projects: Project[]): SidebarList {
  const [filters, setFilters] = useListFilters()
  const [order, setOrder] = useListOrder()
  const [collapsed, setCollapsed] = useCollapsedGroups()
  const [search, setSearch] = useState('')
  const listed = useMemo(() => filterRows(rows, filters, search), [rows, filters, search])
  const groups = useMemo(() => groupRows(sortRows(listed, order), projects), [listed, order, projects])
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
    search,
    setSearch,
    narrowed: search.trim() !== '' || filters.needsMeOnly || filters.hideDrafts,
    clear: () => {
      setSearch('')
      setFilters({ ...filters, needsMeOnly: false, hideDrafts: false })
    },
  }
}
