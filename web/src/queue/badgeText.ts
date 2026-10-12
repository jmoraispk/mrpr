import type { Badge } from './model'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const SIZE_NAMES = { S: 'Small', M: 'Medium', L: 'Large' } as const

export function badgeText(badge: Badge): string {
  switch (badge.kind) {
    case 'blocking':
      return `Blocking ${plural(badge.count, 'person', 'people')}`
    case 'commits-since':
      return `${plural(badge.count, 'commit')} since your review`
    case 'threads-waiting':
      return `${plural(badge.count, 'thread')} waiting on you`
    case 'pipeline-failed':
      return 'Pipeline failed'
    case 'draft':
      return 'Draft'
    case 'ai-authored':
      return 'AI-authored'
    case 'size':
      return badge.size === 'S' && badge.minutes <= 2
        ? `Quick win · ~${badge.minutes} min`
        : `${SIZE_NAMES[badge.size]} · ~${badge.minutes} min`
    case 'waiting-on': {
      const who = badge.names.join(', ') || 'approvals'
      return `Waiting on ${who}${badge.days ? ` for ${plural(badge.days, 'day')}` : ''}`
    }
    case 'changes-addressed':
      return 'Changes addressed'
  }
}

