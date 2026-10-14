import { validHost, type Reply } from './_registry-core.js'

/**
 * When each user first signed in, for a trial later. Tokens never reach this
 * server, so it cannot check who is asking: the record is written once and
 * never moved, and nothing depends on it yet.
 */
export interface UserStore {
  /** Write only if the key is absent; true when written. */
  setIfAbsent(key: string, value: string): Promise<boolean>
  get(key: string): Promise<string | null>
}

export const userKey = (host: string, userId: number) => `user:${host}:${userId}`

export async function recordUser(store: UserStore, input: unknown, now: Date): Promise<Reply> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const host = typeof raw.host === 'string' ? raw.host.trim().toLowerCase() : ''
  if (!validHost(host)) return { status: 400, body: { error: 'bad_host' } }
  const userId = raw.userId
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
    return { status: 400, body: { error: 'bad_user' } }
  }
  const key = userKey(host, userId)
  await store.setIfAbsent(key, JSON.stringify({ firstSeen: now.toISOString() }))
  const stored = await store.get(key)
  const firstSeen = stored
    ? (JSON.parse(stored) as { firstSeen: string }).firstSeen
    : now.toISOString()
  return { status: 200, body: { ok: true, firstSeen } }
}
