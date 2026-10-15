import { FILTER_KEYS, type FilterKey } from '../activity'
import { useActivityFilters } from '../activityFilters'
import type { ListFilters } from '../order'

const LIST_LABELS: [keyof ListFilters, string][] = [
  ['needsMeOnly', 'Needs me only'],
  ['hideDrafts', 'Hide drafts'],
  ['showDone', 'Show done'],
]

const ACTIVITY_LABELS: Record<FilterKey, string> = {
  unresolved: 'Unresolved threads',
  resolved: 'Resolved threads',
  commits: 'New commits',
  bots: 'Bot comments',
  other: 'Other activity (labels, assignees, edits)',
}

/** Every filter, one per line: what the list holds, then what an MR's Activity shows. */
export function FiltersPanel({
  filters,
  onFilters,
  activityKey,
}: {
  filters: ListFilters
  onFilters: (next: ListFilters) => void
  /** The open MR's look key; null with no MR open. */
  activityKey: string | null
}) {
  const activity = useActivityFilters(activityKey)
  return (
    <div className="sb-filters-panel" id="sb-filters-panel">
      <fieldset className="sb-filter-set">
        <legend className="visually-hidden">List</legend>
        {LIST_LABELS.map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={filters[key]}
              onChange={(event) => onFilters({ ...filters, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset className="sb-filter-set">
        <legend>Activity</legend>
        <p className="sb-filter-note">{activityKey ? 'For the open MR' : 'For every MR'}</p>
        {FILTER_KEYS.map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={activity.filters[key]}
              onChange={(event) => activity.setFilter(key, event.target.checked)}
            />
            {ACTIVITY_LABELS[key]}
          </label>
        ))}
        {activity.differs ? (
          <button type="button" className="sb-apply" onClick={activity.applyToAll}>
            Apply to all MRs
          </button>
        ) : null}
      </fieldset>
    </div>
  )
}
