/**
 * Replaces every occurrence of the token in text bound for storage or a page.
 * Lives apart from the router so the background poller can use it without
 * importing the router, which imports the poller.
 */
export function scrubToken(message: string, token: string | null): string {
  if (!token) return message
  return message.split(token).join('[redacted]')
}
