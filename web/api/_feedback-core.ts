import type { Reply } from './_registry-core.js'
import { cleanEmail } from './_waitlist-core.js'

/** Feedback from the app: only what the person typed, plus version and browser. */
export interface FeedbackStore {
  push(key: string, value: string): Promise<void>
}

export const FEEDBACK_KEY = 'feedback'
const MAX_MESSAGE = 5000

export interface FeedbackRecord {
  at: string
  message: string
  email: string | null
  version: string
  browser: string
}

const field = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

export async function saveFeedback(store: FeedbackStore, input: unknown, now: Date): Promise<Reply> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const message = typeof raw.message === 'string' ? raw.message.trim() : ''
  if (!message || message.length > MAX_MESSAGE) return { status: 400, body: { error: 'bad_message' } }
  let email: string | null = null
  if (raw.email !== undefined && raw.email !== null && raw.email !== '') {
    email = cleanEmail(raw.email)
    if (!email) return { status: 400, body: { error: 'bad_email' } }
  }
  // Built field by field: anything else the request carried is never stored.
  const record: FeedbackRecord = {
    at: now.toISOString(),
    message,
    email,
    version: field(raw.version, 40),
    browser: field(raw.browser, 300),
  }
  await store.push(FEEDBACK_KEY, JSON.stringify(record))
  return { status: 200, body: { ok: true } }
}
