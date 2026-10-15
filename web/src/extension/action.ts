import browser from 'webextension-polyfill'

import { buildReviewHash } from '../hub/route'
import { parseMergeRequestUrl } from '../hub/mrUrl'
import { listHosts, type HostConfig } from '../core/hosts'

const HUB_TAB_KEY = 'hubTabId'

export function hashForTab(
  url: string | undefined,
  hosts: HostConfig[],
): string {
  if (!url) return '#/'
  const target = parseMergeRequestUrl(url, hosts)
  return target ? buildReviewHash(target) : '#/'
}

async function knownHubTab(): Promise<number | null> {
  const stored = await browser.storage.local.get(HUB_TAB_KEY)
  const id = stored[HUB_TAB_KEY]
  if (typeof id !== 'number') return null
  try {
    await browser.tabs.get(id)
    return id
  } catch {
    return null
  }
}

/**
 * Drops the remembered hub tab. Call on `runtime.onStartup` and
 * `runtime.onInstalled`.
 *
 * Tab ids are unique only within a browser session, but `storage.local`
 * outlives one. A `hubTabId` written before a restart can therefore name an
 * unrelated tab in the next session, and reusing it would navigate that tab to
 * the hub — discarding whatever the user had open there. Forgetting the id
 * costs at most one redundant hub tab; keeping it risks destroying work.
 */
export async function forgetHubTab(): Promise<void> {
  await browser.storage.local.remove(HUB_TAB_KEY)
}

/**
 * Selecting a tab does not raise the window containing it, so a hub living in a
 * background window would look like a dead click. `browser.windows` is absent
 * on Firefox for Android, which has no windows to raise; there we simply leave
 * the tab selected rather than throwing.
 */
async function focusWindow(windowId: number | undefined): Promise<void> {
  if (typeof windowId !== 'number' || !browser.windows) return
  await browser.windows.update(windowId, { focused: true })
}

export async function openHub(url: string | undefined): Promise<void> {
  const hosts = await listHosts()
  const target = browser.runtime.getURL(`hub.html${hashForTab(url, hosts)}`)

  const existing = await knownHubTab()
  if (existing !== null) {
    const tab = await browser.tabs.update(existing, {
      url: target,
      active: true,
    })
    await focusWindow(tab.windowId)
    return
  }
  const created = await browser.tabs.create({ url: target })
  if (typeof created.id === 'number') {
    await browser.storage.local.set({ [HUB_TAB_KEY]: created.id })
  }
}
