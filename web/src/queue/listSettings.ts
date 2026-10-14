import { SORTS, type ListFilters, type ListOrder, type SortBy } from './order'
import { useStored } from './state'
import { TAG_PRIORITY, type TagKind } from './tags'

export const DEFAULT_LIST_FILTERS: ListFilters = {
  needsMeOnly: false,
  hideDrafts: false,
  showDone: false,
}
export const DEFAULT_LIST_ORDER: ListOrder = { tags: [], sortBy: 'waiting' }
const NONE: string[] = []

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function normalizeListFilters(stored: unknown): ListFilters {
  if (!isRecord(stored)) return DEFAULT_LIST_FILTERS
  const flag = (key: keyof ListFilters) =>
    typeof stored[key] === 'boolean' ? (stored[key] as boolean) : DEFAULT_LIST_FILTERS[key]
  return { needsMeOnly: flag('needsMeOnly'), hideDrafts: flag('hideDrafts'), showDone: flag('showDone') }
}

export function normalizeListOrder(stored: unknown): ListOrder {
  if (!isRecord(stored)) return DEFAULT_LIST_ORDER
  const tags = Array.isArray(stored.tags)
    ? [...new Set(stored.tags.filter((kind): kind is TagKind => TAG_PRIORITY.includes(kind as TagKind)))]
    : []
  const sortBy = SORTS.includes(stored.sortBy as SortBy) ? (stored.sortBy as SortBy) : 'waiting'
  return { tags, sortBy }
}

/** The sidebar's width in pixels: dragged within these limits, saved in this browser. */
export const SIDEBAR_WIDTH = { min: 260, max: 600, default: 360 } as const

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
      typeof stored.width === 'number' && Number.isFinite(stored.width)
        ? clampWidth(stored.width)
        : SIDEBAR_WIDTH.default,
  }
}

export function normalizeCollapsed(stored: unknown): string[] {
  return Array.isArray(stored)
    ? [...new Set(stored.filter((id): id is string => typeof id === 'string'))]
    : NONE
}

/** A tag clicked: added after the ones already chosen, or taken off. */
export function toggleTag(order: ListOrder, kind: TagKind): ListOrder {
  return {
    ...order,
    tags: order.tags.includes(kind)
      ? order.tags.filter((chosen) => chosen !== kind)
      : [...order.tags, kind],
  }
}

export const useListFilters = () =>
  useStored('listFilters', DEFAULT_LIST_FILTERS, normalizeListFilters)
export const useListOrder = () => useStored('listOrder', DEFAULT_LIST_ORDER, normalizeListOrder)
export const useSidebar = () => useStored('sidebar', OPEN, normalizeSidebar)
export const useCollapsedGroups = () => useStored('collapsedGroups', NONE, normalizeCollapsed)
