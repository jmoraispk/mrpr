import { FILTER_KEYS, type FilterKey } from '../activity'
import { useActivityFilters } from '../activityFilters'
import type { Person } from '../activityPeople'
import { When } from './When'

const SHOW_LABELS: Record<FilterKey, string> = {
  unresolved: 'Unresolved threads',
  resolved: 'Resolved threads',
  commits: 'New commits',
  bots: 'Bot comments',
  other: 'Other activity (labels, assignees, edits)',
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Beside the threads: how busy the MR is, who commented (click to see only theirs), and what Activity shows. */
export function ActivityPanel({
  stats,
  lookKey,
  person,
  onPerson,
}: {
  stats: { comments: number; unresolved: number; people: Person[]; last: string | null }
  /** The MR's look key: Show choices are this MR's own until applied to all. */
  lookKey: string
  person: string | null
  onPerson: (username: string | null) => void
}) {
  const settings = useActivityFilters(lookKey)
  return (
    <aside className="mr-rail mr-activity-panel" aria-label="Activity panel">
      <p className="mr-stats">
        {count(stats.comments, 'comment')} · {stats.unresolved} unresolved ·{' '}
        {count(stats.people.length, 'person', 'people')}
        {stats.last ? (
          <>
            {' · last '}
            <When iso={stats.last} />
          </>
        ) : null}
      </p>
      {stats.people.length ? (
        <section>
          <h3>People</h3>
          {stats.people.map((p) => (
            <button
              key={p.username}
              type="button"
              className="mr-person"
              aria-pressed={person === p.username}
              aria-label={`${count(p.count, 'comment')} from ${p.name}`}
              onClick={() => onPerson(person === p.username ? null : p.username)}
            >
              <span className="mr-initial" aria-hidden="true">
                {p.name.slice(0, 1)}
              </span>
              <span className="mr-person-name">{p.name}</span>
              <span className="mr-count">{p.count}</span>
            </button>
          ))}
        </section>
      ) : null}
      <section>
        <h3>Show</h3>
        {FILTER_KEYS.map((key) => (
          <label key={key} className="mr-show">
            <input
              type="checkbox"
              checked={settings.filters[key]}
              onChange={(event) => settings.setFilter(key, event.target.checked)}
            />
            {SHOW_LABELS[key]}
          </label>
        ))}
        {settings.differs ? (
          <button type="button" className="mr-apply" onClick={settings.applyToAll}>
            Apply to all MRs
          </button>
        ) : null}
      </section>
    </aside>
  )
}
