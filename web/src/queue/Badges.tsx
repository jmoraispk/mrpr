import { badgeText } from './badgeText'
import type { Badge, Bucket } from './model'

export function Badges({ badges, bucket }: { badges: Badge[]; bucket?: Bucket }) {
  return (
    <span className="q-badges">
      {badges.map((badge) => (
        <span key={badge.kind} className={`q-badge q-badge-${badge.kind}`}>
          {badgeText(badge, bucket)}
        </span>
      ))}
    </span>
  )
}
