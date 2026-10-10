/**
 * In-memory stand-in for the `browser.*` API from `webextension-polyfill`.
 *
 * Required usage pattern — the order matters:
 *
 * ```ts
 * const fake = createFakeBrowser()
 * vi.mock('webextension-polyfill', () => ({ default: fake }))
 *
 * const { saveHost } = await import('./hosts')
 * ```
 *
 * The dynamic `await import(...)` is not optional. `vi.mock` is hoisted to the
 * top of the test file, but a *static* `import` of the module under test is
 * hoisted too and would bind the real `webextension-polyfill` before the mock
 * is installed. Importing dynamically defers that binding until after the mock
 * is registered.
 *
 * For the same reason, the `vi.mock` call must appear literally in the test
 * file. It cannot be wrapped in a helper here: Vitest hoists the call
 * lexically, so a `vi.mock` inside a function in this module gets lifted out of
 * that function to the top of this file, where the function's parameters do not
 * exist — which throws for every test file that merely imports from here.
 *
 * `storage.local` structured-clones on write and on read, mirroring the real
 * API. Values handed back by `get` are therefore detached copies, so mutating
 * one cannot silently write through to storage and disguise a missing `set`.
 *
 * Events (`storage.onChanged`, `alarms.onAlarm`, ...) are `FakeEvent`s: a test
 * fires one with `emit`. `reset` leaves their listeners in place, because the
 * modules under test register them once, at import.
 */

export interface FakeEvent<A extends unknown[]> {
  addListener: (listener: (...args: A) => unknown) => void
  removeListener: (listener: (...args: A) => unknown) => void
  hasListener: (listener: (...args: A) => unknown) => boolean
  /** Calls every listener and waits for any promise one returns. */
  emit: (...args: A) => Promise<void>
}

export function createFakeEvent<A extends unknown[] = unknown[]>(): FakeEvent<A> {
  const listeners = new Set<(...args: A) => unknown>()
  return {
    addListener: (listener) => {
      listeners.add(listener)
    },
    removeListener: (listener) => {
      listeners.delete(listener)
    },
    hasListener: (listener) => listeners.has(listener),
    emit: async (...args) => {
      await Promise.all([...listeners].map((listener) => listener(...args)))
    },
  }
}

export type StorageChanges = Record<
  string,
  { oldValue?: unknown; newValue?: unknown }
>
export type IdleState = 'active' | 'idle' | 'locked'
export interface AlarmInfo {
  periodInMinutes?: number
  delayInMinutes?: number
}

export interface FakeBrowser {
  storage: {
    local: {
      get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
      remove: (keys: string | string[]) => Promise<void>
    }
    onChanged: FakeEvent<[StorageChanges, string]>
  }
  permissions: {
    contains: (value: { origins: string[] }) => Promise<boolean>
    request: (value: { origins: string[] }) => Promise<boolean>
  }
  action: {
    setBadgeText: (details: { text: string }) => Promise<void>
    setBadgeBackgroundColor: (details: { color: string }) => Promise<void>
    onClicked: FakeEvent<[{ url?: string }]>
  }
  alarms: {
    create: (name: string, info: AlarmInfo) => Promise<void>
    onAlarm: FakeEvent<[{ name: string }]>
  }
  idle: {
    queryState: (detectionIntervalInSeconds: number) => Promise<IdleState>
    setDetectionInterval: (intervalInSeconds: number) => void
    onStateChanged: FakeEvent<[IdleState]>
  }
  granted: Set<string>
  /** When true, `permissions.request` resolves false and grants nothing. */
  denyRequests: boolean
  data: Record<string, unknown>
  /** What the toolbar badge currently shows. */
  badge: { text: string; color: string | null }
  /** Alarms created, by name, with the options they were created with. */
  alarmsCreated: Record<string, AlarmInfo>
  /** What `idle.queryState` answers. */
  idleState: IdleState
  idleDetectionInterval: number | null
  /** Clears all stored state. Call from `beforeEach`. */
  reset: () => void
}

export function createFakeBrowser(): FakeBrowser {
  const data: Record<string, unknown> = {}
  const granted = new Set<string>()
  const fake: FakeBrowser = {
    data,
    granted,
    denyRequests: false,
    badge: { text: '', color: null },
    alarmsCreated: {},
    idleState: 'active',
    idleDetectionInterval: null,
    reset: () => {
      for (const key of Object.keys(data)) delete data[key]
      granted.clear()
      fake.denyRequests = false
      fake.badge = { text: '', color: null }
      fake.alarmsCreated = {}
      fake.idleState = 'active'
    },
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return structuredClone(data)
          const list = typeof keys === 'string' ? [keys] : keys
          return Object.fromEntries(
            list
              .filter((key) => key in data)
              .map((key) => [key, structuredClone(data[key])]),
          )
        },
        set: async (items) => {
          const changes: StorageChanges = {}
          for (const [key, value] of Object.entries(items)) {
            changes[key] = {
              oldValue: structuredClone(data[key]),
              newValue: structuredClone(value),
            }
          }
          Object.assign(data, structuredClone(items))
          await fake.storage.onChanged.emit(changes, 'local')
        },
        remove: async (keys) => {
          const changes: StorageChanges = {}
          for (const key of typeof keys === 'string' ? [keys] : keys) {
            if (!(key in data)) continue
            changes[key] = { oldValue: structuredClone(data[key]) }
            delete data[key]
          }
          await fake.storage.onChanged.emit(changes, 'local')
        },
      },
      onChanged: createFakeEvent<[StorageChanges, string]>(),
    },
    permissions: {
      contains: async ({ origins }) =>
        origins.every((origin) => granted.has(origin)),
      request: async ({ origins }) => {
        if (fake.denyRequests) return false
        for (const origin of origins) granted.add(origin)
        return true
      },
    },
    action: {
      setBadgeText: async ({ text }) => {
        fake.badge.text = text
      },
      setBadgeBackgroundColor: async ({ color }) => {
        fake.badge.color = color
      },
      onClicked: createFakeEvent<[{ url?: string }]>(),
    },
    alarms: {
      create: async (name, info) => {
        fake.alarmsCreated[name] = { ...info }
      },
      onAlarm: createFakeEvent<[{ name: string }]>(),
    },
    idle: {
      queryState: async () => fake.idleState,
      setDetectionInterval: (interval) => {
        fake.idleDetectionInterval = interval
      },
      onStateChanged: createFakeEvent<[IdleState]>(),
    },
  }
  return fake
}
