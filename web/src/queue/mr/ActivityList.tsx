import { useEffect } from 'react'

import { relativeTime } from '../../hub/relativeTime'
import { DiscussionThread } from '../../review/DiscussionThread'
import type { ReviewTarget } from '../../transport/types'
import { toThreadDiscussion, type Activity } from '../activity'
import { reviewHash } from '../route'

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
  return `${total} hidden by your Show settings: ${parts.join(', ')}`
}

/** Threads and events in time order, with the divider and what is hidden. */
export function ActivityList({
  activity,
  target,
  onReveal,
  replyTo,
  onReplied,
  focusNoteId = null,
}: {
  activity: Activity
  target: ReviewTarget
  onReveal: () => void
  replyTo: string | null
  onReplied: () => void
  focusNoteId?: number | null
}) {
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
      {activity.items.map((item, index) => (
        <div key={item.kind === 'thread' ? item.discussion.id : `e${item.note.id}`}>
          {index === activity.dividerBefore ? (
            <div className="mr-divider">New since last review</div>
          ) : null}
          {item.kind === 'event' ? (
            <p className={`mr-event${item.isNew ? ' is-new' : ''}`}>
              {item.note.author?.name ?? 'GitLab'} {item.note.body.split('\n')[0]} ·{' '}
              {relativeTime(item.at)}
            </p>
          ) : (
            <div
              className={`mr-thread${item.you ? ' is-yours' : ''}${item.isNew ? ' is-new' : ''}${
                item.discussion.id === focusedId ? ' is-focused' : ''
              }`}
            >
              <p className="mr-thread-head">
                {item.discussion.notes[0].position ? (
                  // An inline thread links to its line in Changes.
                  <a href={reviewHash(target, { tab: 'changes', noteId: item.discussion.notes[0].id })}>
                    {item.discussion.notes[0].position.filePath} · line{' '}
                    {item.discussion.notes[0].position.newLine ??
                      item.discussion.notes[0].position.oldLine}
                  </a>
                ) : (
                  'Overall'
                )}
                {item.category === 'resolved' ? ' · resolved' : ''}
                {item.you ? <strong className="mr-you"> · {YOU_TAGS[item.you]}</strong> : null}
              </p>
              {item.category === 'resolved' && replyTo !== item.discussion.id ? (
                // A shown resolved thread takes one line until opened.
                <details className="mr-resolved">
                  <summary>
                    {item.discussion.notes[0].author?.name}:{' '}
                    {item.discussion.notes[0].body.split('\n')[0].slice(0, 120)}
                  </summary>
                  <DiscussionThread discussion={toThreadDiscussion(item.discussion)} />
                </details>
              ) : (
                <DiscussionThread discussion={toThreadDiscussion(item.discussion)} />
              )}
            </div>
          )}
        </div>
      ))}
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
