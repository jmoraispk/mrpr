import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { createRuntimeTransport } from '../../transport/runtime'
import { waitingOnYou } from '../activity'
import { nudgeText, requestChangesText } from '../commentText'
import { Composer } from '../Composer'
import type { QueueRow } from '../model'
import { Markdown } from '../mr/Markdown'
import type { HeaderRequest } from '../mr/MrHeader'
import { ProjectPicker } from '../ProjectPicker'
import { markRowRead } from '../readState'
import { TagList } from '../TagList'
import type { TagKind } from '../tags'
import { QUEUE_QUERY_KEY } from '../useQueue'

type Mode = null | 'reply' | 'changes' | 'nudge' | 'move'
const STILL_TO_REVIEW = new Set(['UNREVIEWED', 'REVIEW_STARTED'])

/**
 * A row, expanded in place: its tags, the start of its description, the
 * comment waiting on you, and every action. Expanding reads nothing.
 */
export function RowPreview({
  row,
  me,
  order,
  onApprove,
  onSnooze,
  onOpen,
  request,
  onRequestHandled,
}: {
  row: QueueRow
  me: string
  order: TagKind[]
  onApprove: (row: QueueRow) => void
  onSnooze: (row: QueueRow) => void
  onOpen: () => void
  /** An action asked for from the keyboard, run once the MR has loaded. */
  request: HeaderRequest | null
  onRequestHandled: () => void
}) {
  const transport = useMemo(
    () => createRuntimeTransport({ hostId: row.hostId, project: row.project, iid: row.iid }),
    [row.hostId, row.project, row.iid],
  )
  const queryClient = useQueryClient()
  // The MR page's own query, so opening the MR after this is instant.
  const overview = useQuery({
    queryKey: ['overview', `${row.hostId}/${row.project}/${row.iid}`],
    queryFn: () => transport.getOverview!(),
    staleTime: 30_000,
  })
  const [mode, setMode] = useState<Mode>(null)
  const data = overview.data
  const waitingId = data ? waitingOnYou(data.discussions, me) : null
  const waiting = data?.discussions.find((discussion) => discussion.id === waitingId)
  const lastNote = waiting?.notes.filter((note) => !note.system).at(-1)
  const author = data?.author?.username ?? row.mr?.author.username ?? null
  const stillToReview = (row.mr?.reviewers ?? data?.reviewers ?? [])
    .filter((reviewer) => STILL_TO_REVIEW.has(reviewer.state))
    .map((reviewer) => reviewer.username)
  const canNudge =
    row.tags.some((tag) => tag.kind === 'waiting-on') && stillToReview.length > 0

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['overview'] })
    void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
  }
  async function reply(body: string) {
    await transport.replyToDiscussion(waitingId!, body)
    // You answered: what waited on you in this row is read.
    markRowRead(row)
    refresh()
  }
  async function comment(body: string) {
    await transport.postComment!(body)
    refresh()
  }

  useEffect(() => {
    if (!request || overview.isPending) return
    onRequestHandled()
    if (request === 'reply') {
      if (waitingId) setMode('reply')
    } else if (request === 'changes') {
      if (author) setMode('changes')
    } else if (request === 'nudge') {
      if (canNudge) setMode('nudge')
    } else setMode('move')
    // Runs once per request, when the MR is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, overview.isPending])

  return (
    <>
      <TagList tags={row.tags} order={order} />
      {overview.isPending ? (
        <p className="sb-muted">Loading…</p>
      ) : overview.error ? (
        <p className="sb-error" role="alert">
          Couldn't load details ·{' '}
          <button type="button" onClick={() => void overview.refetch()}>
            Retry
          </button>
        </p>
      ) : data ? (
        <>
          {data.description.trim() ? (
            <div className="sb-desc">
              <Markdown source={data.description} host={row.host} project={row.project} />
            </div>
          ) : null}
          {lastNote ? (
            <section className="sb-waiting" aria-label="Waiting on you">
              <p className="sb-who">{lastNote.author?.name ?? 'Someone'}</p>
              <Markdown source={lastNote.body} host={row.host} project={row.project} />
            </section>
          ) : null}
        </>
      ) : null}
      <div className="sb-actions">
        <button type="button" className="q-primary" onClick={() => onApprove(row)}>
          Approve
        </button>
        <button type="button" onClick={() => setMode('reply')} disabled={!waitingId}>
          Reply
        </button>
        <button type="button" onClick={() => setMode('changes')} disabled={!author}>
          Request changes
        </button>
        {canNudge ? (
          <button type="button" onClick={() => setMode('nudge')}>
            Nudge
          </button>
        ) : null}
        <button type="button" onClick={() => onSnooze(row)}>
          {row.snoozed ? 'Unsnooze' : 'Snooze'}
        </button>
        <button type="button" onClick={() => setMode('move')}>
          Move
        </button>
        <button type="button" onClick={onOpen}>
          Open full view
        </button>
      </div>
      {mode === 'reply' && waitingId ? (
        <Composer label="Reply" initial="" onCancel={() => setMode(null)} onSend={reply} />
      ) : null}
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
          initial={nudgeText(stillToReview)}
          onCancel={() => setMode(null)}
          onSend={comment}
        />
      ) : null}
      {mode === 'move' ? <ProjectPicker rowKey={row.key} onDone={() => setMode(null)} /> : null}
    </>
  )
}
