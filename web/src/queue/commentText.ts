/** Prefill for a nudge: tags every reviewer still waiting. */
export function nudgeText(usernames: string[]): string {
  const tags = usernames.map((username) => `@${username}`).join(' ')
  return `${tags} friendly nudge, this one's ready for your review whenever you have a moment.`
}

/** Prefill for requesting changes: tags the author; the user writes the rest. */
export function requestChangesText(author: string): string {
  return `@${author} Requesting changes: `
}
