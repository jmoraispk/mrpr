import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { INBOX_QUERY_KEY } from '../hub/useInbox'
import { createRuntimeTransport } from '../transport/runtime'
import type { QueueRow } from './model'
import { useSnoozed } from './state'
import { QUEUE_QUERY_KEY } from './useQueue'

/** What the queue last did, shown until replaced or dismissed, even after the row moves. */
export type Notice =
  | { kind: 'approved'; row: QueueRow }
  | { kind: 'snoozed'; row: QueueRow }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string }

const targetOf = (row: QueueRow) => ({ hostId: row.hostId, project: row.project, iid: row.iid })

/** Approve and snooze, each with an Undo that survives the row leaving the list. */
export function useRowActions() {
  const queryClient = useQueryClient()
  const [, setSnooze] = useSnoozed()
  const [notice, setNotice] = useState<Notice | null>(null)
  // One request per MR at a time: a double `a` must not approve twice.
  const inFlight = useRef(new Set<string>())
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
  }
  const once = async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    try {
      await work()
    } finally {
      inFlight.current.delete(key)
    }
  }

  function approve(row: QueueRow) {
    void once(row.key, async () => {
      const transport = createRuntimeTransport(targetOf(row))
      try {
        await transport.approve!()
      } catch (error) {
        setNotice({
          kind: 'error',
          message:
            (error as { code?: string } | null)?.code === 'write_access_denied'
              ? `Couldn't approve ${row.title}: posting needs your OK in GitLab.`
              : `Couldn't approve ${row.title}. GitLab may not let you approve this one.`,
        })
        return
      }
      // Approving counts as a look.
      if (row.mr?.headSha) void transport.markLooked?.(row.mr.headSha)
      setNotice({ kind: 'approved', row })
      refresh()
    })
  }

  function snooze(row: QueueRow) {
    if (row.snoozed) {
      setSnooze(row.key, null)
      setNotice(null)
      return
    }
    setSnooze(row.key, row.updatedAt)
    setNotice({ kind: 'snoozed', row })
  }

  function undo() {
    if (notice?.kind === 'snoozed') {
      setSnooze(notice.row.key, null)
      setNotice(null)
      return
    }
    if (notice?.kind !== 'approved') return
    const { row } = notice
    void once(row.key, async () => {
      try {
        await createRuntimeTransport(targetOf(row)).unapprove!()
        setNotice({ kind: 'info', message: `Approval withdrawn: ${row.title}` })
        refresh()
      } catch {
        setNotice({
          kind: 'error',
          message: `Couldn't undo the approval of ${row.title}. It still stands in GitLab.`,
        })
      }
    })
  }

  return { notice, approve, snooze, undo, dismiss: () => setNotice(null) }
}
