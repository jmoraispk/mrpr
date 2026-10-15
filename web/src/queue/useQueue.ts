import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import type { QueueHost } from '../gitlab/queueFacts'
import { hubRequest } from '../hub/api'
import { useInbox } from '../hub/useInbox'
import { INBOX_KEY } from '../inbox/store'
import { platform } from '../platform/platform'
import { createRuntimeTransport } from '../transport/runtime'
import { buildQueue, lookKeyFor, rowKey } from './model'
import { useLastLook, useSnoozed } from './state'

export const QUEUE_QUERY_KEY = ['queue'] as const
const NO_HOSTS: QueueHost[] = []

/** Everything the queue screen shows, refreshed with the inbox and every minute. */
export function useQueue() {
  const queryClient = useQueryClient()
  const inbox = useInbox()
  const [snoozed] = useSnoozed()
  const lastLook = useLastLook()
  const facts = useQuery({
    queryKey: QUEUE_QUERY_KEY,
    queryFn: () => hubRequest<QueueHost[]>('listQueue'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  // A poll that changed the inbox likely changed the MRs too.
  useEffect(
    () =>
      platform().store.subscribe((keys) => {
        if (keys.includes(INBOX_KEY)) {
          void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
        }
      }),
    [queryClient],
  )
  const hosts = facts.data ?? NO_HOSTS

  // Commits since your last look, only for MRs whose head moved since.
  const moved = hosts.flatMap((host) =>
    host.mrs.flatMap((mr) => {
      const look = lastLook[lookKeyFor(host.hostId, mr.project, mr.iid)]
      return look && mr.headSha && look.headSha !== mr.headSha
        ? [{ key: rowKey(host.hostId, mr.id), host, mr, since: look.headSha }]
        : []
    }),
  )
  const counted = useQueries({
    queries: moved.map(({ key, host, mr, since }) => ({
      queryKey: ['commits-since', key, since, mr.headSha],
      queryFn: () =>
        createRuntimeTransport({ hostId: host.hostId, project: mr.project, iid: mr.iid })
          .commitsSince!(since),
      staleTime: Infinity,
      // A failed count just leaves the badge off.
      retry: false,
    })),
  })
  const commitsSince: Record<string, number> = {}
  moved.forEach((entry, index) => {
    const count = counted[index]?.data
    if (count != null) commitsSince[entry.key] = count
  })
  const commitsKey = JSON.stringify(commitsSince)

  const rows = useMemo(
    () =>
      buildQueue({
        hosts,
        items: inbox.data?.items ?? [],
        closed: inbox.data?.closed ?? [],
        snoozed,
        commitsSince: JSON.parse(commitsKey) as Record<string, number>,
        now: new Date(),
      }),
    [hosts, inbox.data, snoozed, commitsKey],
  )
  return {
    rows,
    hosts,
    inbox: inbox.data,
    isLoading: facts.isLoading,
    error: facts.error,
    /** When the MRs were last read (ms), 0 before the first answer. */
    updatedAt: facts.dataUpdatedAt,
    refreshing: facts.isFetching,
    /** Poll GitLab and read the MRs again, now. */
    refresh() {
      void hubRequest('pollNow', { maxAgeMs: 0 }).catch(() => undefined)
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
    },
  }
}
