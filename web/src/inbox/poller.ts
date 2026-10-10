import browser from 'webextension-polyfill'

import { getToken, listHosts, originFor } from '../extension/hosts'
import { scrubToken } from '../extension/scrub'
import { GitLabClient } from '../gitlab/client'
import { GitLabError } from '../gitlab/errors'
import { showUnread } from './badge'
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
    let token: string | null = null
    try {
      token = await getToken(host.id)
      if (!token) {
        throw new GitLabError(
          400,
          'Delta has no token stored for this host',
          'host_not_configured',
        )
      }
      const permitted = await browser.permissions.contains({
        origins: [originFor(host.host)],
      })
      if (!permitted) {
        throw new GitLabError(
          403,
          'Delta no longer has permission for this GitLab host',
          'permission_missing',
        )
      }
      const next = await pollHost({
        client: new GitLabClient(host.apiBase, token),
        hostId: host.id,
        username: host.username,
        previous,
        now: at,
        hideBots: settings.hideBots,
      })
      await updateInbox((state) => commitHost(state, host.id, next))
    } catch (error) {
      // Never thrown out of here: an alarm handler has nowhere to report it,
      // and the inbox is where the user will look.
      const code = error instanceof GitLabError ? error.code : 'delta_internal_error'
      const message = scrubToken(
        error instanceof Error ? error.message : String(error),
        token,
      )
      await updateInbox((state) => recordHostError(state, host.id, { code, message }))
    }
  }

  const final = await updateInbox((state) =>
    pruneHosts(
      state,
      hosts.map((host) => host.id),
    ),
  )
  await showUnread(unreadCount(final))
}
