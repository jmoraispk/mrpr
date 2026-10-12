import { hubRequest } from '../hub/api'
import type { InboxItem } from '../inbox/types'
import type { QueueRow } from './model'

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
