import { useCallback, useEffect, useState } from 'react'

import { platform } from '../platform/platform'

/** A value in this browser's store, kept in sync across hook instances and tabs. */
export function useStored<T>(
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

const NO_MARKS: Record<string, string> = {}

/** Row key → a string; anything else stored is dropped. */
function asMarks(stored: unknown): Record<string, string> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return NO_MARKS
  return Object.fromEntries(
    Object.entries(stored).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>
}

/**
 * Row key → "the MR's updatedAt as you saw it|when you ticked"; null moves it
 * back to To do. Read with `isDone`.
 */
export function useDone(): [Record<string, string>, (key: string, updatedAt: string | null) => void] {
  const [done, setDone] = useStored('done', NO_MARKS, asMarks)
  const update = useCallback(
    (key: string, updatedAt: string | null) => {
      const next = { ...done }
      if (updatedAt) next[key] = `${updatedAt}|${new Date().toISOString()}`
      else delete next[key]
      setDone(next)
    },
    [done, setDone],
  )
  return [done, update]
}

/** Row key → when it was snoozed. A snoozed MR stays hidden until unsnoozed, whatever changes. */
export function useSnoozedMrs(): [Record<string, string>, (key: string, on: boolean) => void] {
  const [snoozed, setSnoozed] = useStored('snoozedMrs', NO_MARKS, asMarks)
  const update = useCallback(
    (key: string, on: boolean) => {
      const next = { ...snoozed }
      if (on) next[key] = new Date().toISOString()
      else delete next[key]
      setSnoozed(next)
    },
    [snoozed, setSnoozed],
  )
  return [snoozed, update]
}

/**
 * Once per browser: the old snoozes meant "until it changes", which is Done
 * now. They move into `done` (what is already there wins) and `snoozed` goes.
 */
export async function migrateSnoozed(): Promise<void> {
  const store = platform().store
  const old = asMarks(await store.get('snoozed'))
  if (Object.keys(old).length > 0) {
    const done = asMarks(await store.get('done'))
    await store.set({ done: { ...old, ...done } })
  }
  await store.remove('snoozed')
}

/** `lookKeyFor(...)` → the head you last reviewed. */
export function useLastLook(): Record<string, { headSha: string; at: string }> {
  return useStored<Record<string, { headSha: string; at: string }>>('lastLook', {})[0]
}

/** One read of a stored value, for callers that must not follow later writes. */
export async function readStored<T>(key: string): Promise<T | undefined> {
  return platform().store.get<T>(key)
}

/** Clocks differ a little between this browser and GitLab. */
const SKEW_MS = 30_000

/**
 * Whether a stored ✓ still holds for an MR now at `updatedAt`: the same
 * version, or one from before you ticked (your own action just before the
 * tick, which the list had not caught up with). Anything later brings it back.
 */
export function isDone(stored: string | undefined, updatedAt: string): boolean {
  if (!stored) return false
  const [version, ticked] = stored.split('|')
  if (version === updatedAt) return true
  const at = Date.parse(ticked ?? '')
  return Number.isFinite(at) && Date.parse(updatedAt) <= at + SKEW_MS
}
