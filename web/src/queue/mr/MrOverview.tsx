import { useMemo, useState, type ReactNode } from 'react'

import type { MrOverview } from '../../gitlab/mrOverview'
import type { ReviewTarget } from '../../transport/types'
import { buildActivity } from '../activity'
import { useActivityFilters } from '../activityFilters'
import { lookKeyFor } from '../model'
import { ActivityList } from './ActivityList'
import { DetailsRail } from './DetailsRail'
import { Markdown } from './Markdown'
import { ShowSettings } from './ShowSettings'

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
}) {
  const settings = useActivityFilters(lookKeyFor(target.hostId, target.project, target.iid))
  const [showOpen, setShowOpen] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  // A reply aimed at a hidden thread shows everything, so the thread is there.
  const revealing = reveal || Boolean(replyTo)
  const since = previous?.at ?? null
  const activity = useMemo(
    () =>
      buildActivity(overview.discussions, { me, since, filters: settings.filters, reveal: revealing }),
    [overview.discussions, me, since, settings.filters, revealing],
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
            <button type="button" aria-expanded={showOpen} onClick={() => setShowOpen((open) => !open)}>
              ⚙ Show
            </button>
          </div>
          {showOpen ? (
            <ShowSettings
              filters={settings.filters}
              scope={settings.scope}
              onChange={settings.setFilter}
              onReset={settings.reset}
            />
          ) : null}
          <ActivityList
            activity={activity}
            target={target}
            onReveal={() => setReveal(true)}
            replyTo={replyTo}
            onReplied={onReplied}
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
