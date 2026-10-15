import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { MrOverview } from '../../gitlab/mrOverview'
import type { ReviewTarget } from '../../transport/types'
import { buildActivity } from '../activity'
import { useActivityFilters } from '../activityFilters'
import { lookKeyFor } from '../model'
import { ActivityList } from './ActivityList'
import { DetailsRail } from './DetailsRail'
import { Markdown } from './Markdown'

const LONG_LINES = 12
const LONG_CHARS = 1200

/** What the MR is about and what needs you: description, Activity, details. */
export function MrOverviewView({
  overview,
  target,
  me,
  previous,
  replyTo,
  onReplied,
  projectName,
  projectColor,
  rebase,
  focusNoteId = null,
}: {
  overview: MrOverview
  target: ReviewTarget
  me: string
  previous: { headSha: string; at: string } | null
  replyTo: string | null
  onReplied: () => void
  projectName: string | null
  projectColor: string | null
  rebase?: ReactNode
  /** Open at this note's thread, as a link to a comment does. */
  focusNoteId?: number | null
}) {
  const settings = useActivityFilters(lookKeyFor(target.hostId, target.project, target.iid))
  const [reveal, setReveal] = useState(false)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  // Threads kept on screen whatever the filters say: the one a link pointed
  // at, and any you are replying in. They stay after the request is used.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => {
    const linked = overview.discussions.find((d) => d.notes.some((n) => n.id === focusNoteId))
    return new Set(linked ? [linked.id] : [])
  })
  const keptNow = useMemo(
    () => (replyTo && !kept.has(replyTo) ? new Set([...kept, replyTo]) : kept),
    [kept, replyTo],
  )
  useEffect(() => {
    if (keptNow !== kept) setKept(keptNow)
  }, [keptNow, kept])
  const since = previous?.at ?? null
  const activity = useMemo(
    () =>
      buildActivity(overview.discussions, {
        me,
        since,
        filters: settings.filters,
        reveal,
        show: keptNow,
      }),
    [overview.discussions, me, since, settings.filters, reveal, keptNow],
  )
  const description = overview.description
  const long = description.split('\n').length > LONG_LINES || description.length > LONG_CHARS
  return (
    <div className="mr-overview">
      <div className="mr-main">
        <section
          className={`mr-description${long && !descriptionOpen ? ' is-clipped' : ''}`}
          aria-label="Description"
        >
          {description.trim() ? (
            <Markdown source={description} host={target.hostId} project={target.project} />
          ) : (
            <p className="mr-muted">No description.</p>
          )}
          {long ? (
            <button type="button" onClick={() => setDescriptionOpen((open) => !open)}>
              {descriptionOpen ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </section>
        <section className="mr-activity" aria-label="Activity">
          <div className="mr-activity-head">
            <h3>Activity</h3>
          </div>
          <ActivityList
            activity={activity}
            target={target}
            onReveal={() => setReveal(true)}
            replyTo={replyTo}
            onReplied={onReplied}
            focusNoteId={focusNoteId}
            expanded={keptNow}
          />
        </section>
      </div>
      <DetailsRail
        overview={overview}
        host={target.hostId}
        me={me}
        projectName={projectName}
        projectColor={projectColor}
        rebase={rebase}
      />
    </div>
  )
}
