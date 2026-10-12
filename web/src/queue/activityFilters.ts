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

/** The ⚙ Show settings for one MR: its own override, else the default for all MRs. */
export function useActivityFilters(lookKey: string) {
  const [store, setStore] = useStored<FilterStore>(KEY, EMPTY, normalizeFilterStore)
  const own = store.perMr[lookKey]
  const without = () => {
    const perMr = { ...store.perMr }
    delete perMr[lookKey]
    return perMr
  }
  return {
    filters: own ?? store.defaults,
    scope: (own ? 'mr' : 'all') as 'mr' | 'all',
    setFilter(key: FilterKey, value: boolean, scope: 'mr' | 'all') {
      if (scope === 'all') {
        // Changing the default also drops this MR's override, so the change shows here.
        setStore({ defaults: { ...store.defaults, [key]: value }, perMr: without() })
      } else {
        setStore({
          ...store,
          perMr: { ...store.perMr, [lookKey]: { ...(own ?? store.defaults), [key]: value } },
        })
      }
    },
    reset() {
      setStore({ ...store, perMr: without() })
    },
  }
}
