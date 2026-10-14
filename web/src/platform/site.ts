import { listHosts } from '../extension/hosts'
import { handleMessage } from '../extension/router'
import { GitLabClient } from '../gitlab/client'
import { GitLabError } from '../gitlab/errors'
import { accessToken, canPost, sessionHosts, signIn, signOut } from '../site/auth'
import type { SiteConfig } from '../site/config'
import { showFaviconDot } from '../site/favicon'
import { requestWriteAccess } from '../site/writeAccess'
import { createLocalStore } from './localStore'
import type { KeyValueStore, Platform } from './types'

/**
 * The website: storage is localStorage, GitLab is called directly with the
 * signed-in user's OAuth token, and the router runs in the page itself.
 */
export function createSitePlatform(
  config: SiteConfig,
  store: KeyValueStore = createLocalStore(),
): Platform {
  const siteHost = (host: string) => config.hosts.find((value) => value.host === host)
  const unconfigured = (host: string) =>
    new GitLabError(400, `This site is not set up for ${host}.`, 'host_not_configured')
  return {
    store,
    needsToken: false,
    async clientFor(host) {
      const site = siteHost(host.host)
      if (!site) throw unconfigured(host.host)
      return new GitLabClient(host.apiBase, () => accessToken(site), {
        // A read-only sign-in asks for posting rights the first time it posts.
        beforeWrite: async () => {
          if (!(await canPost(site.host))) await requestWriteAccess(site.host)
        },
      })
    },

    async connectHost({ host }) {
      const site = siteHost(host)
      if (!site) throw unconfigured(host)
      await signIn(site, window.location.hash || '#/', config.scopes)
      return 'redirecting'
    },
    async disconnectHost(id) {
      const site = siteHost(id)
      if (site) await signOut(site)
    },
    async reauthenticate() {
      // The signed-in server whose session ended, not whichever is configured
      // first: with several servers the order says nothing about which died.
      const live = await sessionHosts()
      const ended = (await listHosts()).find((value) => !live.includes(value.host))
      const site =
        (ended && siteHost(ended.host)) ??
        config.hosts.find((value) => !live.includes(value.host)) ??
        config.hosts[0]
      if (site) await signIn(site, window.location.hash || '#/', config.scopes)
    },
    showUnread: async (count) => showFaviconDot(count > 0),
    send: (message) => handleMessage(message),
  }
}
