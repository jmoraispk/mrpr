const held = new Map<string, Promise<unknown>>()

/**
 * Runs `fn` while holding a named lock. Web Locks coordinate every tab of the
 * site. Where they are missing (older browsers, jsdom), an in-memory chain
 * still serialises callers within this tab.
 *
 * With `ifAvailable`, a held lock means "skip": the result is `undefined` and
 * `fn` never runs.
 */
export async function withLock<T>(
  name: string,
  fn: () => Promise<T>,
  { ifAvailable = false }: { ifAvailable?: boolean } = {},
): Promise<T | undefined> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (locks) {
    return locks.request(name, { ifAvailable }, async (lock) =>
      lock ? fn() : undefined,
    ) as Promise<T | undefined>
  }
  const previous = held.get(name)
  if (previous && ifAvailable) return undefined
  const run = (previous ?? Promise.resolve()).then(fn, fn)
  const tail = run.catch(() => undefined)
  held.set(name, tail)
  try {
    return await run
  } finally {
    if (held.get(name) === tail) held.delete(name)
  }
}
