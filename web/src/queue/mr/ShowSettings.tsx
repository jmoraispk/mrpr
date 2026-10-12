import { FILTER_KEYS, type FilterKey, type Filters } from '../activity'

const LABELS: Record<FilterKey, string> = {
  unresolved: 'Unresolved threads',
  resolved: 'Resolved threads',
  commits: 'New commits',
  bots: 'Bot comments',
  other: 'Other activity (labels, assignees, edits)',
}

/**
 * What Activity shows. A change applies to the chosen scope: all MRs (the
 * default) or this MR only, which keeps its own copy until reset.
 */
export function ShowSettings({
  filters,
  scope,
  onChange,
  onReset,
}: {
  filters: Filters
  scope: 'mr' | 'all'
  onChange: (key: FilterKey, value: boolean, scope: 'mr' | 'all') => void
  onReset: () => void
}) {
  const first = FILTER_KEYS[0]
  return (
    <fieldset className="mr-show">
      <legend className="visually-hidden">What Activity shows</legend>
      {FILTER_KEYS.map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={filters[key]}
            onChange={(event) => onChange(key, event.target.checked, scope)}
          />
          {LABELS[key]}
        </label>
      ))}
      <div className="mr-show-scope" role="radiogroup" aria-label="Apply to">
        Apply to
        <label>
          <input
            type="radio"
            name="mr-show-scope"
            checked={scope === 'mr'}
            // This MR gets its own copy of the current settings.
            onChange={() => onChange(first, filters[first], 'mr')}
          />{' '}
          this MR
        </label>
        <label>
          <input type="radio" name="mr-show-scope" checked={scope === 'all'} onChange={onReset} />{' '}
          all MRs
        </label>
        {scope === 'mr' ? (
          <button type="button" onClick={onReset}>
            Reset to default
          </button>
        ) : null}
      </div>
    </fieldset>
  )
}
