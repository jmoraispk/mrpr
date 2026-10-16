import { withLock } from '../platform/locks'
import { pollAll } from './poller'
import { ACTIVE_POLL_MAX_AGE_MS } from './types'

const POLL_INTERVAL_MS = 60_000

/** Only one tab polls at a time; the others pick the result up from storage. */
export function lockedPoll(options: { maxAgeMs?: number }): Promise<unknown> {
  return withLock('mrpr-inbox-poll', () => pollAll(options), { ifAvailable: true })
}

/**
 * Polls while the page is open: every minute, and on coming back to the
 * tab if the last poll is stale. The hub's open-time `pollNow` covers load.
 */
export function startPageSchedule({
  poll,
  intervalMs = POLL_INTERVAL_MS,
}: {
  poll: (options: { maxAgeMs?: number }) => Promise<unknown>
  intervalMs?: number
}): () => void {
  const timer = window.setInterval(() => void poll({}), intervalMs)
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      void poll({ maxAgeMs: ACTIVE_POLL_MAX_AGE_MS })
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
