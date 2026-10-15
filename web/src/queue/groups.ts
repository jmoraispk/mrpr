import type { QueueRow } from './model'
import { repoGroupId, type RowGroup } from './order'
import { projectOf, type Project } from './projects'
import { useStored } from './state'

const NO_IDS: string[] = []
const NO_NAMES: Record<string, string> = {}

export function normalizeIds(stored: unknown): string[] {
  return Array.isArray(stored)
    ? [...new Set(stored.filter((id): id is string => typeof id === 'string'))]
    : NO_IDS
}

/** Group id → a non-empty name; anything else is dropped. */
export function normalizeNames(stored: unknown): Record<string, string> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return NO_NAMES
  const out: Record<string, string> = {}
  for (const [id, name] of Object.entries(stored)) {
    if (typeof name === 'string' && name.trim()) out[id] = name.trim()
  }
  return out
}

/** Groups in your order (unlisted ones after, as they came), repositories under their display names. */
export function arrangeGroups(
  groups: RowGroup[],
  order: string[],
  names: Record<string, string>,
): RowGroup[] {
  const place = (id: string) => {
    const index = order.indexOf(id)
    return index < 0 ? order.length : index
  }
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => place(a.group.id) - place(b.group.id) || a.index - b.index)
    .map(({ group }) =>
      group.projectId === null && names[group.id] ? { ...group, name: names[group.id] } : group,
    )
}

/**
 * The stored order after moving `id` above or below `target`. The move is
 * made in the whole order (stored ids, then listed groups not stored yet), so
 * groups another tab or a search hides keep their places.
 */
export function moveGroup(
  listed: string[],
  stored: string[],
  id: string,
  target: string,
  place: 'before' | 'after',
): string[] {
  if (id === target || !listed.includes(id) || !listed.includes(target)) return stored
  const all = [...stored, ...listed.filter((other) => !stored.includes(other))]
  const rest = all.filter((other) => other !== id)
  const at = rest.indexOf(target) + (place === 'after' ? 1 : 0)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/** Move up (-1) or down (1) one place; at the ends nothing changes. */
export function shiftGroup(listed: string[], stored: string[], id: string, delta: -1 | 1): string[] {
  const index = listed.indexOf(id)
  const to = index + delta
  if (index < 0 || to < 0 || to >= listed.length) return stored
  return moveGroup(listed, stored, id, listed[to], delta < 0 ? 'before' : 'after')
}

/** Rows without the muted repositories' own; a row you put in a project stays there. */
export function withoutMuted(
  rows: QueueRow[],
  muted: Record<string, string>,
  projects: Project[],
): QueueRow[] {
  if (Object.keys(muted).length === 0) return rows
  return rows.filter((row) => !muted[repoGroupId(row)] || Boolean(projectOf(row, projects)))
}

export const useGroupOrder = () => useStored('groupOrder', NO_IDS, normalizeIds)
export const useGroupNames = () => useStored('groupNames', NO_NAMES, normalizeNames)
/** Muted repository group id → its path, so a muted repository with no MRs can still be named. */
export const useMutedGroups = () => useStored('mutedGroups', NO_NAMES, normalizeNames)
