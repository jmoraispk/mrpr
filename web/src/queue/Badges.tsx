import { badgeText } from './badgeText'
import type { Badge } from './model'

export function Badges({ badges }: { badges: Badge[] }) {
  return (
    <span className="q-badges">
      {badges.map((badge) => (
        <span key={badge.kind} className={`q-badge q-badge-${badge.kind}`}>
          {badgeText(badge)}
        </span>
      ))}
    </span>
  )
}
