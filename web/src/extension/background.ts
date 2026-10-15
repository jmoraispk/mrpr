import browser from 'webextension-polyfill'

import { installInboxPolling, startInboxPolling } from '../inbox/schedule'
import { createExtensionPlatform } from '../platform/extension'
import { installPlatform } from '../platform/platform'
import { forgetHubTab, openHub } from './action'
import type { DeltaMessage } from '../core/messages'
import { handleMessage } from '../core/router'

// Before any listener: every handler below reaches storage through it.
installPlatform(createExtensionPlatform())

// Returning the promise is the cross-browser way to reply asynchronously with
// webextension-polyfill.
browser.runtime.onMessage.addListener((message: unknown) =>
  handleMessage(message as DeltaMessage),
)

/**
 * The only place a background failure can surface. Nothing here has a UI to
 * fail into: an unhandled rejection in a service worker is swallowed, so a
 * toolbar click that opens nothing would otherwise leave no trace for the user
 * or for a maintainer reading the worker's console in a bug report.
 */
function report(error: unknown): void {
  console.error('[delta] background task failed', error)
}

browser.action.onClicked.addListener((tab) => {
  void openHub(tab.url).catch(report)
})

installInboxPolling(report)

// A remembered tab id only means anything within the session that issued it.
// Both events start a session whose ids bear no relation to the stored one.
browser.runtime.onStartup.addListener(() => {
  void forgetHubTab().catch(report)
  void startInboxPolling().catch(report)
})
browser.runtime.onInstalled.addListener(() => {
  void forgetHubTab().catch(report)
  void startInboxPolling().catch(report)
})
