import type { KeyValueStore } from '../platform/types'
import type { SiteConfig, SiteHost } from './config'
import type { Server } from './server'

/** Setups pasted in this browser: host → Application ID. */
export const CUSTOM_HOSTS_KEY = 'customHosts'
const CLIENT_ID = /^[0-9a-f]{64}$/
const REGISTRY = `${import.meta.env.BASE_URL}api/registry`

export async function loadCustomHosts(store: KeyValueStore): Promise<SiteHost[]> {
  const stored = (await store.get<Record<string, string>>(CUSTOM_HOSTS_KEY)) ?? {}
  return Object.entries(stored).map(([host, clientId]) => ({ host, clientId }))
}

export async function rememberHost(store: KeyValueStore, site: SiteHost): Promise<void> {
  const stored = (await store.get<Record<string, string>>(CUSTOM_HOSTS_KEY)) ?? {}
  await store.set({ [CUSTOM_HOSTS_KEY]: { ...stored, [site.host]: site.clientId } })
}

/** Add `site` to the running config, replacing any entry for the same host. */
export function adoptSite(config: SiteConfig, site: SiteHost): void {
  const index = config.hosts.findIndex((value) => value.host === site.host)
  if (index >= 0) config.hosts[index] = site
  else config.hosts.push(site)
}

/** The directory's id for `host`, or null for unknown or unreachable. */
export async function lookupDirectory(host: string): Promise<string | null> {
  try {
    const response = await fetch(`${REGISTRY}?host=${encodeURIComponent(host)}`)
    if (!response.ok) return null
    const { clientId } = (await response.json()) as { clientId?: unknown }
    return typeof clientId === 'string' && CLIENT_ID.test(clientId) ? clientId : null
  } catch {
    return null
  }
}

/** Share a working id with the next person from this server. Never throws. */
export async function publishToDirectory(host: string, clientId: string): Promise<void> {
  try {
    await fetch(REGISTRY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host, clientId }),
    })
  } catch {
    // Sign-in already worked; the directory is a convenience for others.
  }
}

export async function resolveServer(
  server: Server,
  config: SiteConfig,
): Promise<{ site: SiteHost; source: 'config' | 'directory' } | null> {
  const known = config.hosts.find((value) => value.host === server.host)
  if (known) return { site: known, source: 'config' }
  const clientId = await lookupDirectory(server.host)
  return clientId ? { site: { host: server.host, clientId }, source: 'directory' } : null
}
