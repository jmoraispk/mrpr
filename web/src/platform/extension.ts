import browser from 'webextension-polyfill'

import {
  getToken,
  hostIdFor,
  originFor,
  removeHost,
  saveHost,
  type HostConfig,
} from '../core/hosts'
import { GitLabClient } from '../gitlab/client'
import { GitLabError } from '../gitlab/errors'
import { getCurrentUser } from '../gitlab/user'
import { showUnread } from '../inbox/badge'
import type { Platform } from './types'

/** Today's extension behaviour, behind the shared `Platform` interface. */
export function createExtensionPlatform(): Platform {
  return {
    needsToken: true,
    store: {
      get: async <T,>(key: string) =>
        (await browser.storage.local.get(key))[key] as T | undefined,
      set: (items) => browser.storage.local.set(items),
      remove: (key) => browser.storage.local.remove(key),
      subscribe: (listener) => {
        const onChanged = (changes: Record<string, unknown>, area: string) => {
          if (area === 'local') listener(Object.keys(changes))
        }
        browser.storage.onChanged.addListener(onChanged)
        return () => browser.storage.onChanged.removeListener(onChanged)
      },
    },
    async clientFor(host: HostConfig) {
      const token = await getToken(host.id)
      if (!token) {
        throw new GitLabError(
          400,
          'That GitLab host is not configured in Delta',
          'host_not_configured',
        )
      }
      // The user can revoke a host permission in browser settings at any
      // time. Without this check the browser blocks the fetch and the client
      // reports it as `gitlab_unavailable`, telling the user to wait out an
      // outage when the real fix is one permission grant.
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
      return new GitLabClient(host.apiBase, token)
    },
    async connectHost({ host, apiBase, token }) {
      const user = await getCurrentUser(new GitLabClient(apiBase, token ?? ''))
      const config: HostConfig = {
        id: hostIdFor(host),
        host: hostIdFor(host),
        apiBase,
        userId: user.id,
        username: user.username,
      }
      await saveHost(config, token)
      return config
    },
    disconnectHost: (id) => removeHost(id),
    showUnread,
    send: (message) => browser.runtime.sendMessage(message) as never,
    hasHostAccess: (host) =>
      browser.permissions.contains({ origins: [originFor(host)] }),
    requestHostAccess: (host) =>
      browser.permissions.request({ origins: [originFor(host)] }),
    reload: () => browser.runtime.reload(),
  }
}
