import { listHosts } from '../core/hosts'
import { GitLabError } from '../gitlab/errors'
import { platform } from '../platform/platform'
import { pollHost } from './pollHost'
import {
  commitHost,
  loadInbox,
  loadSettings,
  pruneHosts,
  recordHostError,
  unreadCount,
  updateInbox,
} from './store'

export interface PollOptions {
  /** Injected by tests; defaults to the wall clock. */
  now?: () => Date
  /** Skip any host polled more recently than this. */
  maxAgeMs?: number
}

let running: Promise<void> | null = null

/**
 * Polls every configured host, one after another. A call made while a poll is
 * already running gets that poll rather than starting a second one beside it.
 */
export function pollAll(options: PollOptions = {}): Promise<void> {
  if (running) return running
  running = run(options).finally(() => {
    running = null
  })
  return running
}

async function run({
  now = () => new Date(),
  maxAgeMs,
}: PollOptions): Promise<void> {
  const hosts = await listHosts()
  const settings = await loadSettings()
  const initial = await loadInbox()

  for (const host of hosts) {
    const previous = initial.hosts[host.id] ?? null
    const at = now()
    if (
      maxAgeMs !== undefined &&
      previous?.lastPollAt &&
      at.getTime() - Date.parse(previous.lastPollAt) < maxAgeMs
    ) {
      continue
    }
    try {
      const next = await pollHost({
        client: await platform().clientFor(host),
        hostId: host.id,
        username: host.username,
        previous,
        now: at,
        hideBots: settings.hideBots,
      })
      await updateInbox((state) => commitHost(state, host.id, next))
    } catch (error) {
      // Never thrown out of here: a timer has nowhere to report it, and the
      // inbox is where the user will look. The client has already scrubbed
      // its credential out of any message.
      const code = error instanceof GitLabError ? error.code : 'mrpr_internal_error'
      const message = error instanceof Error ? error.message : String(error)
      await updateInbox((state) => recordHostError(state, host.id, { code, message }))
    }
  }

  const final = await updateInbox((state) =>
    pruneHosts(
      state,
      hosts.map((host) => host.id),
    ),
  )
  await platform().showUnread(unreadCount(final))
}
