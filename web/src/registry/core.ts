/**
 * The shared directory: which OAuth Application ID Mr. PR uses on which GitLab
 * server. It holds nothing else. An Application ID is public by design under
 * PKCE, so the directory leaks no secret, only which servers use Mr. PR.
 */
export interface RegistryEntry {
  clientId: string
  savedAt: string
}

export interface RegistryStore {
  get(key: string): Promise<RegistryEntry | null>
  /** Write only if the key is absent; true when written. */
  setIfAbsent(key: string, value: RegistryEntry): Promise<boolean>
  /** Overwrite only if the stored clientId equals `expectedClientId`. */
  replaceIf(key: string, expectedClientId: string, value: RegistryEntry): Promise<boolean>
}

export interface Reply {
  status: number
  body: unknown
}

export const CLIENT_ID_PATTERN = /^[0-9a-f]{64}$/

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`)
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

export function validHost(host: string): boolean {
  return HOSTNAME.test(host) && !IPV4.test(host)
}

export function registryKey(host: string): string {
  return `registry:${host.toLowerCase()}`
}

const badHost: Reply = { status: 400, body: { error: 'bad_host' } }

export async function lookup(store: RegistryStore, rawHost: string): Promise<Reply> {
  const host = rawHost.trim().toLowerCase()
  if (!validHost(host)) return badHost
  const entry = await store.get(registryKey(host))
  return entry
    ? { status: 200, body: { clientId: entry.clientId } }
    : { status: 404, body: { error: 'unknown' } }
}

export async function save(store: RegistryStore, input: unknown, now: Date): Promise<Reply> {
  const { host: rawHost, clientId, replaces } = (input ?? {}) as Record<string, unknown>
  const host = typeof rawHost === 'string' ? rawHost.trim().toLowerCase() : ''
  if (!validHost(host)) return badHost
  if (typeof clientId !== 'string' || !CLIENT_ID_PATTERN.test(clientId)) {
    return { status: 400, body: { error: 'bad_client_id' } }
  }
  const key = registryKey(host)
  const entry: RegistryEntry = { clientId, savedAt: now.toISOString() }
  if (typeof replaces === 'string' && CLIENT_ID_PATTERN.test(replaces)) {
    await store.replaceIf(key, replaces, entry)
  } else {
    await store.setIfAbsent(key, entry)
  }
  const stored = await store.get(key)
  return { status: 200, body: { clientId: stored?.clientId ?? clientId } }
}
