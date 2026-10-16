import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type { MrOverview } from '../../gitlab/mrOverview'
import type { ReviewTarget } from '../../transport/types'
import { buildActivity } from '../activity'
import { useActivityFilters } from '../activityFilters'
import { activityStats } from '../activityPeople'
import { lookKeyFor } from '../model'
import { ActivityList } from './ActivityList'
import { ActivityPanel } from './ActivityPanel'
import { Markdown } from './Markdown'

const LONG_LINES = 12
const LONG_CHARS = 1200

/** What the MR is about and what needs you: description and Activity. */
export function MrOverviewView({
  overview,
  target,
  me,
  previous,
  replyTo,
  onReplied,
  focusNoteId = null,
}: {
  overview: MrOverview
  target: ReviewTarget
  me: string
  previous: { headSha: string; at: string } | null
  replyTo: string | null
  onReplied: () => void
  /** Open at this note's thread, as a link to a comment does. */
  focusNoteId?: number | null
}) {
  // Back on Overview after a reply here (another tab, the same visit): the MR
  // was marked stale, so read it again now.
  const queryClient = useQueryClient()
  const overviewKey = `${target.hostId}/${target.project}/${target.iid}`
  useEffect(() => {
    void queryClient.refetchQueries({ queryKey: ['overview', overviewKey], stale: true })
  }, [queryClient, overviewKey])
  const lookKey = lookKeyFor(target.hostId, target.project, target.iid)
  const settings = useActivityFilters(lookKey)
  // Whose threads Activity shows; everyone's by default, and again on another MR.
  const [person, setPerson] = useState<string | null>(null)
  useEffect(() => setPerson(null), [overviewKey])
  const stats = useMemo(() => activityStats(overview.discussions), [overview.discussions])
  const personName = stats.people.find((p) => p.username === person)?.name ?? null
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
        person: personName ? person : null,
      }),
    [overview.discussions, me, since, settings.filters, reveal, keptNow, person, personName],
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
          {personName ? (
            <p className="mr-person-filter">
              Showing threads with {personName} ·{' '}
              <button type="button" onClick={() => setPerson(null)}>
                Show everyone
              </button>
            </p>
          ) : null}
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
      <ActivityPanel stats={stats} lookKey={lookKey} person={person} onPerson={setPerson} />
    </div>
  )
}
