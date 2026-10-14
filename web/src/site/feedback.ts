/** The build this page came from: the short commit on Vercel, `dev` elsewhere. */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev'

const FEEDBACK_URL = `${import.meta.env.BASE_URL}api/feedback/`

export interface FeedbackInput {
  message: string
  email: string
}

/** The server refused the feedback: `code` is its reason (`bad_email`, `bad_message`) or `http_<status>`. */
export class FeedbackError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`Feedback was not accepted (${code}).`)
    this.name = 'FeedbackError'
    this.code = code
  }
}

/** Send what the user typed, with the app version and the browser. Nothing else. */
export async function sendFeedback({ message, email }: FeedbackInput): Promise<void> {
  const response = await fetch(FEEDBACK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: message.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
      version: APP_VERSION,
      browser: navigator.userAgent,
    }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    throw new FeedbackError(typeof body?.error === 'string' ? body.error : `http_${response.status}`)
  }
}
