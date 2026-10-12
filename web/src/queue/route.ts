import { buildReviewHash, parseRoute } from '../hub/route'
import type { ReviewTarget } from '../transport/types'
import { BUCKET_ORDER, type Bucket } from './model'

/** The signed-in site's routes, in the URL hash. */
export type SiteRoute =
  | { name: 'queue'; bucket: Bucket | null }
  | { name: 'project'; id: string }
  | { name: 'review'; target: ReviewTarget; noteId: number | null; since: boolean }
  | { name: 'settings' }

const SINCE = '/since'

export function reviewHash(
  target: ReviewTarget,
  { noteId = null, since = false }: { noteId?: number | null; since?: boolean } = {},
): string {
  return `${buildReviewHash(target, noteId)}${since ? SINCE : ''}`
}

export function parseSiteRoute(hash: string): SiteRoute {
  const path = hash.replace(/^#/, '')
  if (path === '/settings') return { name: 'settings' }
  const bucket = path.match(/^\/bucket\/([a-z-]+)$/)?.[1]
  if (bucket) {
    return {
      name: 'queue',
      bucket: BUCKET_ORDER.includes(bucket as Bucket) ? (bucket as Bucket) : null,
    }
  }
  const project = path.match(/^\/project\/([\w-]+)$/)?.[1]
  if (project) return { name: 'project', id: project }
  if (path.startsWith('/mr/')) {
    const since = path.endsWith(SINCE)
    const route = parseRoute(`#${since ? path.slice(0, -SINCE.length) : path}`)
    if (route.name === 'review') {
      return { name: 'review', target: route.target, noteId: route.noteId, since }
    }
  }
  return { name: 'queue', bucket: null }
}
