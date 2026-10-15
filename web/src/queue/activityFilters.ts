import { DEFAULT_FILTERS, FILTER_KEYS, type FilterKey, type Filters } from './activity'
import { useStored } from './state'

interface FilterStore {
  defaults: Filters
  perMr: Record<string, Filters>
}

const KEY = 'activityFilters'
const EMPTY: FilterStore = { defaults: DEFAULT_FILTERS, perMr: {} }

/** Filters from a stored value; null when it is not one. Missing keys take the defaults. */
function asFilters(value: unknown): Filters | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const out = { ...DEFAULT_FILTERS }
  for (const key of FILTER_KEYS) {
    if (!(key in record)) continue
    if (typeof record[key] !== 'boolean') return null
    out[key] = record[key] as boolean
  }
  return out
}

/** Only well-formed settings survive a read; a damaged value falls back to the defaults. */
export function normalizeFilterStore(value: unknown): FilterStore {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const perMr: Record<string, Filters> = {}
  const stored = record.perMr
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    for (const [key, raw] of Object.entries(stored)) {
      const filters = asFilters(raw)
      if (filters) perMr[key] = filters
    }
  }
  return { defaults: asFilters(record.defaults) ?? { ...DEFAULT_FILTERS }, perMr }
}

const same = (a: Filters, b: Filters) => FILTER_KEYS.every((key) => a[key] === b[key])

/**
 * What Activity shows. With an MR open (a look key), a change is that MR's
 * own copy; Apply to all MRs makes it the default. With none open, a change
 * edits the default.
 */
export function useActivityFilters(lookKey: string | null) {
  const [store, setStore] = useStored<FilterStore>(KEY, EMPTY, normalizeFilterStore)
  const own = lookKey ? store.perMr[lookKey] : undefined
  const filters = own ?? store.defaults
  const without = () => {
    const perMr = { ...store.perMr }
    if (lookKey) delete perMr[lookKey]
    return perMr
  }
  return {
    filters,
    /** This MR has choices of its own that differ from the default. */
    differs: Boolean(own && !same(own, store.defaults)),
    setFilter(key: FilterKey, value: boolean) {
      const next = { ...filters, [key]: value }
      if (!lookKey) {
        setStore({ ...store, defaults: next })
        return
      }
      // A copy that matches the default is no copy at all.
      setStore({
        ...store,
        perMr: same(next, store.defaults) ? without() : { ...store.perMr, [lookKey]: next },
      })
    },
    applyToAll() {
      if (!own) return
      setStore({ defaults: own, perMr: without() })
    },
  }
}
