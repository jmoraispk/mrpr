import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'

import { DiscussionThread } from '../../review/DiscussionThread'
import type { ReviewTarget } from '../../transport/types'
import { firstNote, toThreadDiscussion, type Activity } from '../activity'
import { reviewHash } from '../route'
import { QUEUE_QUERY_KEY } from '../useQueue'
import { CodeSnippet } from './CodeSnippet'
import { When } from './When'

const EMPTY: ReadonlySet<string> = new Set()

const YOU_TAGS = {
  mentioned: 'mentions you',
  replied: 'you replied',
  started: 'you started',
} as const

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

function hiddenSentence(hidden: Activity['hidden']): string | null {
  const total = hidden.resolved + hidden.bots + hidden.commits + hidden.other
  if (!total) return null
  const parts = [
    hidden.resolved ? count(hidden.resolved, 'resolved thread') : null,
    hidden.bots ? count(hidden.bots, 'bot comment') : null,
    hidden.commits ? count(hidden.commits, 'commit event') : null,
    hidden.other ? count(hidden.other, 'other event') : null,
  ].filter(Boolean)
  return `${total} hidden by your Filters: ${parts.join(', ')}`
}

/** Threads and events in time order, with the divider and what is hidden. */
export function ActivityList({
  activity,
  target,
  onReveal,
  replyTo,
  onReplied,
  focusNoteId = null,
  expanded = EMPTY,
}: {
  activity: Activity
  target: ReviewTarget
  onReveal: () => void
  replyTo: string | null
  onReplied: () => void
  focusNoteId?: number | null
  /** Threads shown in full even when resolved: the one being replied in, or linked to. */
  expanded?: ReadonlySet<string>
}) {
  const queryClient = useQueryClient()
  // A reply or resolve shows in its own thread at once; only the list is read
  // again now, so the row's state follows. The MR page is not reloaded for it,
  // only marked stale: coming back to it reads it again, reply included.
  const overviewKey = `${target.hostId}/${target.project}/${target.iid}`
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['overview', overviewKey], refetchType: 'none' })
  }, [queryClient, overviewKey])
  // A reply asked for from the header: focus that thread's reply box.
  useEffect(() => {
    if (!replyTo) return
    const box = document.querySelector<HTMLTextAreaElement>(
      `[data-discussion-id="${CSS.escape(replyTo)}"] textarea`,
    )
    if (!box) return
    box.focus()
    box.scrollIntoView?.({ block: 'center' })
    onReplied()
  }, [replyTo, activity, onReplied])

  // The thread a link pointed at: scrolled into view once and marked.
  const focused = activity.items.find(
    (item) => item.kind === 'thread' && item.discussion.notes.some((note) => note.id === focusNoteId),
  )
  const focusedId = focused?.kind === 'thread' ? focused.discussion.id : null
  useEffect(() => {
    if (!focusedId) return
    document
      .querySelector(`[data-discussion-id="${CSS.escape(focusedId)}"]`)
      ?.scrollIntoView?.({ block: 'center' })
  }, [focusedId])

  const hidden = hiddenSentence(activity.hidden)
  return (
    <div className="mr-activity-list">
      {activity.items.length === 0 ? (
        <p className="q-empty">Nothing to show with these settings.</p>
      ) : null}
      {activity.items.map((item, index) => {
        const first = item.kind === 'thread' ? firstNote(item.discussion) : undefined
        return (
          <div key={item.kind === 'thread' ? item.discussion.id : `e${item.note.id}`}>
            {index === activity.dividerBefore ? (
              <div className="mr-divider">New since last review</div>
            ) : null}
            {item.kind === 'event' ? (
              <p className={`mr-event${item.isNew ? ' is-new' : ''}`}>
                {item.note.author?.name ?? 'GitLab'} {item.note.body.split('\n')[0]} ·{' '}
                <When iso={item.at} />
              </p>
            ) : (
              <div
                className={`mr-thread${item.you ? ' is-yours' : ''}${item.isNew ? ' is-new' : ''}${
                  item.discussion.id === focusedId ? ' is-focused' : ''
                }`}
              >
                <p className="mr-thread-head">
                  {first?.position ? (
                    // An inline thread links to its line in Changes.
                    <a href={reviewHash(target, { tab: 'changes', noteId: first.id })}>
                      {first.position.filePath} · line{' '}
                      {first.position.newLine ?? first.position.oldLine}
                    </a>
                  ) : (
                    'Overall'
                  )}
                  {item.category === 'resolved' ? ' · resolved' : ''}
                  {item.you ? <strong className="mr-you"> · {YOU_TAGS[item.you]}</strong> : null}
                </p>
                {first?.position && !(item.category === 'resolved' && !expanded.has(item.discussion.id)) ? (
                  // A resolved thread folded to one line shows (and fetches) no code.
                  <CodeSnippet position={first.position} />
                ) : null}
                {item.category === 'resolved' && !expanded.has(item.discussion.id) ? (
                  // A shown resolved thread takes one line until opened.
                  <details className="mr-resolved">
                    <summary>
                      {first?.author?.name}: {first?.body.split('\n')[0].slice(0, 120)}
                    </summary>
                    <DiscussionThread
                      variant="chat"
                      discussion={toThreadDiscussion(item.discussion)}
                      onChanged={refresh}
                    />
                  </details>
                ) : (
                  <DiscussionThread
                    variant="chat"
                    discussion={toThreadDiscussion(item.discussion)}
                    onChanged={refresh}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
      {hidden ? (
        <p className="mr-hidden">
          {hidden} ·{' '}
          <button type="button" onClick={onReveal}>
            Show them
          </button>
        </p>
      ) : null}
    </div>
  )
}
