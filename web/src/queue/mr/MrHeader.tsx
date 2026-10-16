import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { MrOverview } from '../../gitlab/mrOverview'
import { createRuntimeTransport } from '../../transport/runtime'
import type { ReviewTarget } from '../../transport/types'
import { TagList } from '../TagList'
import { nudgeText, requestChangesText } from '../commentText'
import { Composer } from '../Composer'
import type { QueueRow } from '../model'
import { waitingOnYou } from '../activity'
import { latestWaiting } from '../readState'
import { QUEUE_QUERY_KEY } from '../useQueue'
import { When } from './When'

/** An action asked for from the keyboard, run once by the header. */
export type HeaderRequest = 'reply' | 'changes' | 'nudge'
type Mode = null | 'changes' | 'nudge'

const WAITING = new Set(['UNREVIEWED', 'REVIEW_STARTED'])

/** The MR's title, who wants to merge what, and every action on it. */
export function MrHeader({
  target,
  row,
  overview,
  full,
  fullHref,
  closeHref,
  onApprove,
  onSnooze,
  onReply,
  request,
  onRequestHandled,
  extraActions,
  me,
}: {
  target: ReviewTarget
  row: QueueRow | null
  overview: MrOverview | undefined
  full: boolean
  fullHref: string
  closeHref: string
  onApprove: () => void
  onSnooze: () => void
  /** Reply happens in the Overview's thread; the header points to it. */
  onReply: (discussionId: string) => void
  request: HeaderRequest | null
  onRequestHandled: () => void
  /** More actions after the standard ones (Rebase). */
  extraActions?: ReactNode
  /** Your username on this host, to find the thread waiting on you. */
  me: string
}) {
  const transport = useMemo(() => createRuntimeTransport(target), [target])
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>(null)
  const title = overview?.title ?? row?.title ?? `!${target.iid}`
  const author = overview?.author?.username ?? row?.mr?.author.username ?? null
  const authorName = overview?.author?.name ?? row?.mr?.author.name ?? null
  // The thread waiting on you, from the MR itself: opening it marks the inbox read.
  const waitingId =
    (overview ? waitingOnYou(overview.discussions, me) : null) ??
    (row ? latestWaiting(row)?.discussionId : null) ??
    null
  const reviewers = row?.mr?.reviewers ?? overview?.reviewers ?? []
  const waitingReviewers = reviewers
    .filter((reviewer) => WAITING.has(reviewer.state))
    .map((reviewer) => reviewer.username)
  const canNudge =
    waitingReviewers.length > 0 &&
    (row
      ? row.tags.some((tag) => tag.kind === 'waiting-on-others')
      : Boolean(overview && overview.approvalsLeft > 0))

  async function comment(body: string) {
    await transport.postComment!(body)
    void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['overview'] })
  }

  useEffect(() => {
    if (!request) return
    onRequestHandled()
    if (request === 'reply') {
      if (waitingId) onReply(waitingId)
    } else if (request === 'changes') {
      if (author) setMode('changes')
    } else if (request === 'nudge') {
      if (canNudge) setMode('nudge')
    }
    // Runs once per request; the handlers read this render's MR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  return (
    <header className="mr-header">
      <div className="mr-head-controls">
        <a href={fullHref}>{full ? 'Leave full screen' : 'Full screen'}</a>
        <a href={closeHref}>Close</a>
      </div>
      <h2 className="mr-title">
        {title}
        {overview?.draft ? <span className="mr-draft">Draft</span> : null}
        {overview?.state === 'merged' || row?.mr?.state === 'merged' ? (
          <span className="mr-draft is-merged">Merged</span>
        ) : null}
      </h2>
      <p className="mr-meta">
        {target.project} !{target.iid}
        {authorName && overview ? (
          <>
            {' · '}
            {authorName} wants to merge <code>{overview.sourceBranch}</code> →{' '}
            <code>{overview.targetBranch}</code>
            {' · '}opened <When iso={overview.createdAt} /> · updated <When iso={overview.updatedAt} />
          </>
        ) : null}
      </p>
      {row ? <TagList tags={row.tags} /> : null}
      <div className="mr-actions">
        <button type="button" className="q-primary" onClick={onApprove}>
          Approve
        </button>
        <button type="button" onClick={() => setMode('changes')} disabled={!author}>
          Request changes
        </button>
        {canNudge ? (
          <button type="button" onClick={() => setMode('nudge')}>
            Nudge
          </button>
        ) : null}
        {row ? (
          <button type="button" onClick={onSnooze} title="Hide it until you unsnooze it">
            {row.snoozed ? 'Unsnooze' : 'Snooze'}
          </button>
        ) : null}
        {extraActions}
        {overview?.webUrl || row?.webUrl ? (
          <a href={overview?.webUrl || row?.webUrl} target="_blank" rel="noreferrer">
            Open in GitLab ↗
          </a>
        ) : null}
      </div>
      <div className="mr-compose">
        {mode === 'changes' && author ? (
          <Composer
            label="Request changes"
            initial={requestChangesText(author)}
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
      </div>
    </header>
  )
}
