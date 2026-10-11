import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { INBOX_KEY } from '../inbox/store'
import { platform } from '../platform/platform'
import type { InboxView } from '../inbox/types'
import { hubRequest } from './api'

export const INBOX_QUERY_KEY = ['inbox'] as const
const TITLE = 'Mr. PR'

/**
 * The inbox as the worker last stored it. The worker polls on an alarm while
 * this page may be open, so the page listens for the stored inbox changing
 * and re-reads it. It never reads or writes the key itself.
 */
export function useInbox() {
  const queryClient = useQueryClient()
  const inbox = useQuery({
    queryKey: INBOX_QUERY_KEY,
    queryFn: () => hubRequest<InboxView>('listInbox'),
  })
  useEffect(
    () =>
      platform().store.subscribe((keys) => {
        if (keys.includes(INBOX_KEY)) {
          void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
        }
      }),
    [queryClient],
  )
  return inbox
}

/** The tab says there is something to read, from the tab strip. */
export function useUnreadTitle(unread: number): void {
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${TITLE}` : TITLE
  }, [unread])
}

export function mergeRequestKey(
  hostId: string,
  project: string,
  iid: number,
): string {
  return `${hostId}:${project}!${iid}`
}

export function unreadMergeRequests(view?: InboxView): Set<string> {
  return new Set(
    (view?.items ?? [])
      .filter((item) => !item.read)
      .map((item) => mergeRequestKey(item.hostId, item.project, item.iid)),
  )
}
