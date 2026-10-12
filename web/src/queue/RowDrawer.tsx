import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { INBOX_QUERY_KEY } from '../hub/useInbox'
import { createRuntimeTransport } from '../transport/runtime'
import { nudgeText, requestChangesText } from './commentText'
import { Composer } from './Composer'
import type { QueueRow } from './model'
import { ProjectPicker } from './ProjectPicker'
import { focusNoteOf, latestWaiting, markItemsRead } from './readState'
import { reviewHash } from './route'
import { QUEUE_QUERY_KEY } from './useQueue'

type Mode = null | 'reply' | 'changes' | 'nudge' | 'move'
/** An action asked for from the keyboard, run once by the drawer. */
export type DrawerRequest = 'approve' | 'reply' | 'changes' | 'nudge' | 'snooze' | 'move'

/**
 * What you can do to one row without opening it. Approve and snooze belong to
 * the queue, whose notice (with Undo) outlives the row moving away.
 */
export function RowDrawer({
  row,
  onClose,
  onApprove,
  onSnooze,
  onOpen = () => {},
  request = null,
  onRequestHandled = () => {},
}: {
  row: QueueRow
  onClose: () => void
  onApprove: () => void
  onSnooze: () => void
  /** Called as the review opens from here. */
  onOpen?: () => void
  request?: DrawerRequest | null
  onRequestHandled?: () => void
}) {
  const target = { hostId: row.hostId, project: row.project, iid: row.iid }
  const transport = createRuntimeTransport(target)
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>(null)
  const waitingThread = latestWaiting(row)
  const waitingReviewers = (row.mr?.reviewers ?? [])
    .filter((reviewer) => reviewer.state === 'UNREVIEWED' || reviewer.state === 'REVIEW_STARTED')
    .map((reviewer) => reviewer.username)
  const canNudge = row.bucket === 'waiting' && waitingReviewers.length > 0
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
  }

  async function reply(body: string) {
    if (!waitingThread?.discussionId) return
    await transport.replyToDiscussion(waitingThread.discussionId, body)
    // Answered: the thread no longer waits on you.
    await markItemsRead(
      row.items.filter((item) => item.discussionId === waitingThread.discussionId),
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
    if (request === 'approve') onApprove()
    else if (request === 'snooze') onSnooze()
    else if (request === 'reply') {
      if (waitingThread) setMode('reply')
    } else if (request === 'nudge') {
      if (canNudge) setMode('nudge')
    } else if (request === 'changes') {
      if (row.mr) setMode('changes')
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
        <a
          className="q-primary"
          href={reviewHash(target, { noteId: focusNoteOf(row) })}
          onClick={onOpen}
        >
          Open review
        </a>
        <button type="button" onClick={onApprove}>
          Approve
        </button>
        <button type="button" onClick={() => setMode('reply')} disabled={!waitingThread}>
          Reply
        </button>
        <button type="button" onClick={() => setMode('changes')} disabled={!row.mr}>
          Request changes
        </button>
        {canNudge ? (
          <button type="button" onClick={() => setMode('nudge')}>
            Nudge
          </button>
        ) : null}
        <button type="button" onClick={onSnooze}>
          {row.snoozed ? 'Unsnooze' : 'Snooze'}
        </button>
        <button type="button" onClick={() => setMode('move')}>
          Move to project
        </button>
      </div>
      {mode === 'reply' && waitingThread ? (
        <Composer label="Reply" initial="" onCancel={() => setMode(null)} onSend={reply} />
      ) : null}
      {mode === 'changes' && row.mr ? (
        <Composer
          label="Request changes"
          initial={requestChangesText(row.mr.author.username)}
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
