import { buildReviewHash, parseRoute } from '../hub/route'
import type { ReviewTarget } from '../transport/types'
import { BUCKET_ORDER, type Bucket } from './model'

/** The MR panel's tabs: Overview first, then the code. */
export type ReviewTab = 'overview' | 'changes' | 'since'
const CODE_TABS: ReviewTab[] = ['changes', 'since']
const FULL = '/full'

/** The signed-in site's routes, in the URL hash. */
export type SiteRoute =
  | { name: 'queue'; bucket: Bucket | null }
  | { name: 'project'; id: string }
  | { name: 'review'; target: ReviewTarget; noteId: number | null; tab: ReviewTab; full: boolean }
  | { name: 'settings' }
  | { name: 'snoozed' }

/** `#/mr/<host>/<project>/<iid>[/note/<id>][/changes|/since][/full]` */
export function reviewHash(
  target: ReviewTarget,
  {
    noteId = null,
    tab = 'overview',
    full = false,
  }: { noteId?: number | null; tab?: ReviewTab; full?: boolean } = {},
): string {
  return `${buildReviewHash(target, noteId)}${tab === 'overview' ? '' : `/${tab}`}${full ? FULL : ''}`
}

/** Where a list lives, so closing an MR returns to the list it was opened from. */
export function listHash(route: SiteRoute): string {
  switch (route.name) {
    case 'queue':
      return route.bucket ? `#/bucket/${route.bucket}` : '#/'
    case 'project':
      return `#/project/${route.id}`
    case 'snoozed':
      return '#/snoozed'
    case 'settings':
      return '#/settings'
    default:
      return '#/'
  }
}

export function parseSiteRoute(hash: string): SiteRoute {
  const path = hash.replace(/^#/, '')
  if (path === '/settings') return { name: 'settings' }
  if (path === '/snoozed') return { name: 'snoozed' }
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
    let rest = path
    const full = rest.endsWith(FULL)
    if (full) rest = rest.slice(0, -FULL.length)
    const tab = CODE_TABS.find((name) => rest.endsWith(`/${name}`)) ?? 'overview'
    if (tab !== 'overview') rest = rest.slice(0, -(tab.length + 1))
    const route = parseRoute(`#${rest}`)
    if (route.name === 'review') {
      return { name: 'review', target: route.target, noteId: route.noteId, tab, full }
    }
  }
  return { name: 'queue', bucket: null }
}
