import { platform } from '../platform/platform'

const HOSTS_KEY = 'hosts'
const TOKENS_KEY = 'tokens'

export interface HostConfig {
  id: string
  host: string
  apiBase: string
  userId: number
  username: string
}

export function hostIdFor(host: string): string {
  return host.trim().toLowerCase()
}

export function originFor(host: string): string {
  return `https://${host}/*`
}

async function read<T>(key: string, fallback: T): Promise<T> {
  return (await platform().store.get<T>(key)) ?? fallback
}

export async function listHosts(): Promise<HostConfig[]> {
  return read<HostConfig[]>(HOSTS_KEY, [])
}

export async function getHost(id: string): Promise<HostConfig | null> {
  return (await listHosts()).find((host) => host.id === id) ?? null
}

/**
 * Saves a host, and its personal access token when one is given. Only the
 * extension stores tokens here; the site's OAuth tokens live in `site/auth`.
 */
export async function saveHost(
  config: HostConfig,
  token?: string,
): Promise<void> {
  const hosts = (await listHosts()).filter((host) => host.id !== config.id)
  const items: Record<string, unknown> = { [HOSTS_KEY]: [...hosts, config] }
  if (token !== undefined) {
    const tokens = await read<Record<string, string>>(TOKENS_KEY, {})
    items[TOKENS_KEY] = { ...tokens, [config.id]: token }
  }
  await platform().store.set(items)
}

export async function removeHost(id: string): Promise<void> {
  const hosts = (await listHosts()).filter((host) => host.id !== id)
  const tokens = await read<Record<string, string>>(TOKENS_KEY, {})
  delete tokens[id]
  await platform().store.set({ [HOSTS_KEY]: hosts, [TOKENS_KEY]: tokens })
}

export async function getToken(id: string): Promise<string | null> {
  const tokens = await read<Record<string, string>>(TOKENS_KEY, {})
  return tokens[id] ?? null
}
