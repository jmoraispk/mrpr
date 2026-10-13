import { SORTS, type ListFilters, type ListOrder, type SortBy } from './order'
import { useStored } from './state'
import { TAG_PRIORITY, type TagKind } from './tags'

export const DEFAULT_LIST_FILTERS: ListFilters = {
  needsMeOnly: false,
  hideDrafts: false,
  showDone: false,
}
export const DEFAULT_LIST_ORDER: ListOrder = { tags: [], sortBy: 'waiting' }
const OPEN = { open: true }
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

export function normalizeSidebar(stored: unknown): { open: boolean } {
  return isRecord(stored) && typeof stored.open === 'boolean' ? { open: stored.open } : OPEN
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
