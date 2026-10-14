/** The build this page came from: the short commit on Vercel, `dev` elsewhere. */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev'

const FEEDBACK_URL = `${import.meta.env.BASE_URL}api/feedback/`

export interface FeedbackInput {
  message: string
  email: string
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
  if (!response.ok) throw new Error(`Feedback was not accepted (${response.status}).`)
}
