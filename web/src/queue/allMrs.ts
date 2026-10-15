import type { QueueRow } from './model'
import { repoGroupId } from './order'

const PER_HOST = 20

/** Per host, the repositories of these rows, most recently updated first, without muted ones. */
export function reposToList(
  rows: QueueRow[],
  muted: Record<string, string>,
): Record<string, string[]> {
  const latest = new Map<string, { hostId: string; project: string; at: number }>()
  for (const row of rows) {
    if (muted[repoGroupId(row)]) continue
    const key = `${row.hostId}\n${row.project}`
    const at = Date.parse(row.updatedAt) || 0
    if ((latest.get(key)?.at ?? -1) < at) latest.set(key, { hostId: row.hostId, project: row.project, at })
  }
  const out: Record<string, string[]> = {}
  for (const value of [...latest.values()].sort((a, b) => b.at - a.at)) {
    const list = (out[value.hostId] ??= [])
    if (list.length < PER_HOST) list.push(value.project)
  }
  return out
}
