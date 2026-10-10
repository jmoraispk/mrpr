import browser from 'webextension-polyfill'

import { pollAll } from './poller'
import { ACTIVE_POLL_MAX_AGE_MS } from './types'

export const POLL_ALARM = 'delta-inbox-poll'
export const POLL_PERIOD_MINUTES = 2
/** Seconds without input after which the machine counts as idle. */
export const IDLE_AFTER_SECONDS = 300

/** Nobody is there to read a badge on an idle or locked machine. */
export async function pollIfActive(): Promise<void> {
  if ((await browser.idle.queryState(IDLE_AFTER_SECONDS)) !== 'active') return
  await pollAll()
}

/**
 * Registers the inbox's listeners. Call synchronously at the top level of the
 * service worker: a worker woken by an alarm only delivers it to listeners
 * that exist before its first `await`.
 */
export function installInboxPolling(report: (error: unknown) => void): void {
  browser.idle.setDetectionInterval(IDLE_AFTER_SECONDS)
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLL_ALARM) void pollIfActive().catch(report)
  })
  browser.idle.onStateChanged.addListener((state) => {
    if (state === 'active') {
      void pollAll({ maxAgeMs: ACTIVE_POLL_MAX_AGE_MS }).catch(report)
    }
  })
}

/**
 * Creates the repeating alarm and polls once. Call on startup and install:
 * alarms are not guaranteed to survive a browser restart, and creating one
 * with an existing name replaces it rather than adding a second.
 */
export async function startInboxPolling(): Promise<void> {
  await browser.alarms.create(POLL_ALARM, {
    periodInMinutes: POLL_PERIOD_MINUTES,
  })
  await pollIfActive()
}
