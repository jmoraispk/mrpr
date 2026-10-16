import type { ListFilters } from '../order'

const LABELS: [keyof ListFilters, string][] = [
  ['allMrs', 'All MRs'],
  ['needsMeOnly', 'Needs me only'],
  ['hideDrafts', 'Hide drafts'],
  ['showMerged', 'Show merged'],
]

/** What the list holds, one toggle per line. What an MR's Activity shows lives in its panel. */
export function FiltersPanel({
  filters,
  onFilters,
}: {
  filters: ListFilters
  onFilters: (next: ListFilters) => void
}) {
  return (
    <div className="sb-filters-panel" id="sb-filters-panel">
      <fieldset className="sb-filter-set">
        <legend className="visually-hidden">Filters</legend>
        {LABELS.map(([key, label]) => (
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
    </div>
  )
}
