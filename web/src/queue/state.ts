import { useCallback, useEffect, useState } from 'react'

import { platform } from '../platform/platform'
import { normalizeProjects, type Project } from './projects'

/** A value in this browser's store, kept in sync across hook instances and tabs. */
function useStored<T>(
  key: string,
  fallback: T,
  // Whatever is stored passes through this first; a damaged value must not crash the app.
  clean: (stored: unknown) => T = (stored) => (stored as T | undefined) ?? fallback,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback)
  useEffect(() => {
    let live = true
    const read = () =>
      void platform()
        .store.get<unknown>(key)
        .then((stored) => {
          if (live) setValue(clean(stored))
        })
    read()
    const stop = platform().store.subscribe((keys) => {
      if (keys.includes(key)) read()
    })
    return () => {
      live = false
      stop()
    }
    // fallback is a literal at each call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const update = useCallback(
    (next: T) => {
      setValue(next)
      void platform().store.set({ [key]: next })
    },
    [key],
  )
  return [value, update]
}

export function useProjects(): [Project[], (next: Project[]) => void] {
  return useStored<Project[]>('projects', [], normalizeProjects)
}

/** Row key → the MR's updatedAt when snoozed; null unsnoozes. */
export function useSnoozed(): [
  Record<string, string>,
  (key: string, updatedAt: string | null) => void,
] {
  const [snoozed, setSnoozed] = useStored<Record<string, string>>('snoozed', {})
  const update = useCallback(
    (key: string, updatedAt: string | null) => {
      const next = { ...snoozed }
      if (updatedAt) next[key] = updatedAt
      else delete next[key]
      setSnoozed(next)
    },
    [snoozed, setSnoozed],
  )
  return [snoozed, update]
}

/** `lookKeyFor(...)` → the head you last reviewed. */
export function useLastLook(): Record<string, { headSha: string; at: string }> {
  return useStored<Record<string, { headSha: string; at: string }>>('lastLook', {})[0]
}
