import type { HostConfig } from '../extension/hosts'
import { platform } from '../platform/platform'

/** `host:userId` of every user already reported from this browser. */
export const FIRST_SEEN_KEY = 'firstSeenSent'

const USERS_URL = `${import.meta.env.BASE_URL}api/users/`

const postUser = (body: { host: string; userId: number }) =>
  fetch(USERS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Tell the server when each user first signed in: once per browser; a failure waits for the next visit. */
export async function recordFirstSeen(
  hosts: HostConfig[],
  post: (body: { host: string; userId: number }) => Promise<Response> = postUser,
): Promise<void> {
  const sent = (await platform().store.get<string[]>(FIRST_SEEN_KEY)) ?? []
  const done = [...sent]
  for (const host of hosts) {
    const id = `${host.host}:${host.userId}`
    if (done.includes(id)) continue
    try {
      if ((await post({ host: host.host, userId: host.userId })).ok) done.push(id)
    } catch {
      // Offline or the server is down: the next visit tries again.
    }
  }
  if (done.length !== sent.length) await platform().store.set({ [FIRST_SEEN_KEY]: done })
}
