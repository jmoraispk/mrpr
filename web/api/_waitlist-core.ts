import type { Reply } from './_registry-core.js'

/** The GitHub waitlist: emails only, kept as a set so joining twice is harmless. */
export interface WaitlistStore {
  add(key: string, member: string): Promise<void>
}

export const WAITLIST_KEY = 'waitlist:github'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A trimmed, lowercased email address, or null. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

export async function joinWaitlist(store: WaitlistStore, input: unknown): Promise<Reply> {
  const email = cleanEmail(
    input && typeof input === 'object' ? (input as { email?: unknown }).email : undefined,
  )
  if (!email) return { status: 400, body: { error: 'bad_email' } }
  await store.add(WAITLIST_KEY, email)
  return { status: 200, body: { ok: true } }
}
