import { SORTS, type ListFilters, type ListOrder, type ListView, type SidebarTab, type SortBy } from './order'
import { useStored } from './state'

export const DEFAULT_LIST_FILTERS: ListFilters = {
  needsMeOnly: false,
  hideDrafts: false,
  showMerged: true,
  allMrs: false,
}
export const DEFAULT_LIST_ORDER: ListOrder = { sortBy: 'changed', descending: true }
const NONE: string[] = []

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function normalizeListFilters(stored: unknown): ListFilters {
  if (!isRecord(stored)) return DEFAULT_LIST_FILTERS
  const flag = (key: keyof ListFilters) =>
    typeof stored[key] === 'boolean' ? (stored[key] as boolean) : DEFAULT_LIST_FILTERS[key]
  return {
    needsMeOnly: flag('needsMeOnly'),
    hideDrafts: flag('hideDrafts'),
    showMerged: flag('showMerged'),
    allMrs: flag('allMrs'),
  }
}

export function normalizeListOrder(stored: unknown): ListOrder {
  if (!isRecord(stored)) return DEFAULT_LIST_ORDER
  if (!SORTS.includes(stored.sortBy as SortBy) || typeof stored.descending !== 'boolean') {
    return DEFAULT_LIST_ORDER
  }
  return { sortBy: stored.sortBy as SortBy, descending: stored.descending }
}

/** The sidebar's width in pixels: dragged within these limits, saved in this browser. */
export const SIDEBAR_WIDTH = { min: 260, max: 600, default: 400 } as const
// The default before 400; every toggle of the sidebar stored it, so it is read as "the default".
const OLD_DEFAULT_WIDTH = 360

export interface SidebarSettings {
  open: boolean
  width: number
}

const OPEN: SidebarSettings = { open: true, width: SIDEBAR_WIDTH.default }

export const clampWidth = (width: number) =>
  Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)))

export function normalizeSidebar(stored: unknown): SidebarSettings {
  if (!isRecord(stored)) return OPEN
  return {
    open: typeof stored.open === 'boolean' ? stored.open : true,
    width:
      typeof stored.width === 'number' && Number.isFinite(stored.width) && stored.width !== OLD_DEFAULT_WIDTH
        ? clampWidth(stored.width)
        : SIDEBAR_WIDTH.default,
  }
}

export function normalizeCollapsed(stored: unknown): string[] {
  return Array.isArray(stored)
    ? [...new Set(stored.filter((id): id is string => typeof id === 'string'))]
    : NONE
}

export const useListFilters = () =>
  useStored('listFilters', DEFAULT_LIST_FILTERS, normalizeListFilters)
export const useListOrder = () => useStored('listOrder', DEFAULT_LIST_ORDER, normalizeListOrder)
export const useSidebar = () => useStored('sidebar', OPEN, normalizeSidebar)
export const useCollapsedGroups = () => useStored('collapsedGroups', NONE, normalizeCollapsed)
export const normalizeTab = (stored: unknown): SidebarTab => (stored === 'mine' ? 'mine' : 'others')
export const useSidebarTab = () => useStored<SidebarTab>('sidebarTab', 'others', normalizeTab)
export const useFiltersOpen = () => useStored<boolean>('filtersOpen', false, (stored) => stored === true)
export const normalizeListView = (stored: unknown): ListView =>
  stored === 'done' || stored === 'all' ? stored : 'todo'
export const useListView = () => useStored<ListView>('listView', 'todo', normalizeListView)
