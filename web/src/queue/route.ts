import { buildReviewHash, parseRoute } from '../hub/route'
import type { ReviewTarget } from '../transport/types'

/** The MR panel's tabs: Overview first, then the code. */
export type ReviewTab = 'overview' | 'changes' | 'since'
const CODE_TABS: ReviewTab[] = ['changes', 'since']
const FULL = '/full'

/** The signed-in site's routes, in the URL hash. */
export type SiteRoute =
  | { name: 'queue' }
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

/** Anything else, old bucket and project links included, is the list. */
export function parseSiteRoute(hash: string): SiteRoute {
  const path = hash.replace(/^#/, '')
  if (path === '/settings') return { name: 'settings' }
  if (path === '/snoozed') return { name: 'snoozed' }
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
  return { name: 'queue' }
}
