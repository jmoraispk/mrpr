import { hubRequest } from '../hub/api'
import type { InboxItem } from '../inbox/types'
import type { QueueRow } from './model'

const isForMe = (item: InboxItem) => item.kind === 'reply' || item.kind === 'mention'

/** The newest of these items, whatever order they arrive in. */
function newest(items: InboxItem[]): InboxItem | undefined {
  return items.reduce<InboxItem | undefined>(
    (best, item) => (!best || Date.parse(item.createdAt) > Date.parse(best.createdAt) ? item : best),
    undefined,
  )
}

/** The newest unread reply or mention: the thread waiting on you. */
export function latestWaiting(row: QueueRow): InboxItem | undefined {
  return newest(row.items.filter((item) => !item.read && isForMe(item)))
}

/** The note to open the review at: the newest waiting thread, else the newest unread note. */
export function focusNoteOf(row: QueueRow): number | null {
  const unread = row.items.filter((item) => !item.read && item.noteId !== null)
  return (newest(unread.filter(isForMe)) ?? newest(unread))?.noteId ?? null
}

/** Mark these inbox items read. A failure only leaves them unread. */
export async function markItemsRead(items: InboxItem[]): Promise<void> {
  const ids = items.filter((item) => !item.read).map((item) => item.id)
  if (!ids.length) return
  await hubRequest('markRead', { ids }).catch(() => {})
}

/** Opening an MR reads everything folded into its row. */
export function markRowRead(row: QueueRow): void {
  void markItemsRead(row.items)
}
