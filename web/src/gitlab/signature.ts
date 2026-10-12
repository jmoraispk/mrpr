export const SIGNATURE = '*— via Mr. PR*'

/** Sign a comment Mr. PR posts, once. Removing it is a later, paid setting. */
export function withSignature(body: string): string {
  const trimmed = body.trimEnd()
  return trimmed.endsWith(SIGNATURE) ? trimmed : `${trimmed}\n\n${SIGNATURE}`
}
