import { hubRequest } from '../hub/api'
import type { InboxItem } from '../inbox/types'
import type { QueueRow } from './model'

/** Mark these inbox items read. A failure only leaves them unread. */
export async function markItemsRead(items: InboxItem[]): Promise<void> {
  const ids = items.filter((item) => !item.read).map((item) => item.id)
  if (!ids.length) return
  await hubRequest('markRead', { ids }).catch(() => {})
}

/** The note to open the review at: the latest unread one, preferring threads waiting on you. */
export function focusNoteOf(row: QueueRow): number | null {
  const unread = row.items.filter((item) => !item.read && item.noteId !== null)
  const forMe = unread.filter((item) => item.kind === 'reply' || item.kind === 'mention')
  return (forMe.at(-1) ?? unread.at(-1))?.noteId ?? null
}

/** Opening an MR reads everything folded into its row. */
export function markRowRead(row: QueueRow): void {
  void markItemsRead(row.items)
}
