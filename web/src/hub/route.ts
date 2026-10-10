import type { ReviewTarget } from '../transport/types'

export type Route =
  | { name: 'inbox' }
  | { name: 'mergeRequests' }
  | { name: 'settings' }
  | { name: 'review'; target: ReviewTarget; noteId: number | null }

export function buildReviewHash(
  target: ReviewTarget,
  noteId?: number | null,
): string {
  const base = `#/mr/${encodeURIComponent(target.hostId)}/${encodeURIComponent(
    target.project,
  )}/${target.iid}`
  return noteId ? `${base}/note/${noteId}` : base
}

function positiveInteger(value: string): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  if (path === '/settings') return { name: 'settings' }
  if (path === '/merge-requests') return { name: 'mergeRequests' }

  const fallback: Route = { name: 'inbox' }
  const segments = path.split('/').filter(Boolean)
  if (segments[0] !== 'mr') return fallback

  let noteId: number | null = null
  if (segments.length === 6 && segments[4] === 'note') {
    noteId = positiveInteger(segments[5])
    if (noteId === null) return fallback
  } else if (segments.length !== 4) {
    return fallback
  }

  const iid = positiveInteger(segments[3])
  if (iid === null) return fallback

  // decodeURIComponent throws on a bad percent sequence, and a hash can always
  // be hand-edited. Fall back rather than letting the hub crash.
  let hostId: string
  let project: string
  try {
    hostId = decodeURIComponent(segments[1])
    project = decodeURIComponent(segments[2])
  } catch {
    return fallback
  }

  return { name: 'review', target: { hostId, project, iid }, noteId }
}
