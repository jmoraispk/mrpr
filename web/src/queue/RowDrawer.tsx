import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { INBOX_QUERY_KEY } from '../hub/useInbox'
import { createRuntimeTransport } from '../transport/runtime'
import { nudgeText, requestChangesText } from './commentText'
import { Composer } from './Composer'
import type { QueueRow } from './model'
import { ProjectPicker } from './ProjectPicker'
import { markItemsRead } from './readState'
import { reviewHash } from './route'
import { useSnoozed } from './state'
import { QUEUE_QUERY_KEY } from './useQueue'

type Mode = null | 'reply' | 'changes' | 'nudge' | 'move'
/** An action asked for from the keyboard, run once by the drawer. */
export type DrawerRequest = 'approve' | 'reply' | 'changes' | 'nudge' | 'snooze' | 'move'

/** What you can do to one row without opening it. */
export function RowDrawer({
  row,
  onClose,
  onOpen = () => {},
  request = null,
  onRequestHandled = () => {},
}: {
  row: QueueRow
  onClose: () => void
  /** Called as the review opens from here. */
  onOpen?: () => void
  request?: DrawerRequest | null
  onRequestHandled?: () => void
}) {
  const target = { hostId: row.hostId, project: row.project, iid: row.iid }
  const transport = createRuntimeTransport(target)
  const queryClient = useQueryClient()
  const [, snooze] = useSnoozed()
  const [mode, setMode] = useState<Mode>(null)
  const [approved, setApproved] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const unreadForMe = row.items.filter(
    (item) => !item.read && (item.kind === 'reply' || item.kind === 'mention'),
  )
  // The latest thread waiting on you.
  const waitingThread = unreadForMe.at(-1)
  const waitingReviewers = (row.mr?.reviewers ?? [])
    .filter((reviewer) => reviewer.state === 'UNREVIEWED' || reviewer.state === 'REVIEW_STARTED')
    .map((reviewer) => reviewer.username)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
  }

  async function approve() {
    try {
      await transport.approve!()
      setApproved(true)
      setNotice(null)
      // Approving counts as a look, and moves the row out of Needs you on the next fetch.
      if (row.mr?.headSha) void transport.markLooked?.(row.mr.headSha)
      refresh()
    } catch {
      setNotice("Couldn't approve. GitLab may not let you approve this one.")
    }
  }

  async function undo() {
    try {
      await transport.unapprove!()
      setApproved(false)
      refresh()
    } catch {
      setNotice("Couldn't undo the approval. It still stands in GitLab.")
    }
  }

  async function reply(body: string) {
    if (!waitingThread?.discussionId) return
    await transport.replyToDiscussion(waitingThread.discussionId, body)
    // Answered: the thread no longer waits on you.
    await markItemsRead(
      unreadForMe.filter((item) => item.discussionId === waitingThread.discussionId),
    )
    refresh()
  }

  async function comment(body: string) {
    await transport.postComment!(body)
    refresh()
  }

  useEffect(() => {
    if (!request) return
    onRequestHandled()
    if (request === 'approve') {
      if (!approved) void approve()
    } else if (request === 'snooze') snooze(row.key, row.updatedAt)
    else if (request === 'reply') {
      if (waitingThread) setMode('reply')
    } else if (request === 'nudge') {
      if (row.bucket === 'waiting' && waitingReviewers.length) setMode('nudge')
    } else setMode(request)
    // Runs once per request; the handlers read this render's row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  return (
    <aside className="q-drawer" aria-label={`Actions for ${row.title}`}>
      <header className="q-drawer-head">
        <h2>{row.title}</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {waitingThread?.excerpt ? (
        <blockquote className="q-excerpt">{waitingThread.excerpt}</blockquote>
      ) : null}
      <div className="q-actions">
        <a className="q-primary" href={reviewHash(target)} onClick={onOpen}>
          Open review
        </a>
        {approved ? (
          <span className="q-approved">
            Approved ·{' '}
            <button type="button" onClick={() => void undo()}>
              Undo
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => void approve()}>
            Approve
          </button>
        )}
        <button type="button" onClick={() => setMode('reply')} disabled={!waitingThread}>
          Reply
        </button>
        <button type="button" onClick={() => setMode('changes')}>
          Request changes
        </button>
        {row.bucket === 'waiting' && waitingReviewers.length ? (
          <button type="button" onClick={() => setMode('nudge')}>
            Nudge
          </button>
        ) : null}
        <button type="button" onClick={() => snooze(row.key, row.updatedAt)}>
          Snooze
        </button>
        <button type="button" onClick={() => setMode('move')}>
          Move to project
        </button>
      </div>
      {notice ? (
        <p className="mutation-error" role="alert">
          {notice}
        </p>
      ) : null}
      {mode === 'reply' && waitingThread ? (
        <Composer label="Reply" initial="" onCancel={() => setMode(null)} onSend={reply} />
      ) : null}
      {mode === 'changes' ? (
        <Composer
          label="Request changes"
          initial={requestChangesText(row.mr?.author.username ?? '')}
          onCancel={() => setMode(null)}
          onSend={comment}
        />
      ) : null}
      {mode === 'nudge' ? (
        <Composer
          label="Nudge"
          initial={nudgeText(waitingReviewers)}
          onCancel={() => setMode(null)}
          onSend={comment}
        />
      ) : null}
      {mode === 'move' ? <ProjectPicker rowKey={row.key} onDone={() => setMode(null)} /> : null}
    </aside>
  )
}
