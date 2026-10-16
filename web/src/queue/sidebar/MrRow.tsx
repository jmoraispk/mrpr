import { useEffect, useRef } from 'react'

import { shortTime } from '../../hub/relativeTime'
import type { QueueRow } from '../model'

const ACTION_LABEL = { done: 'Mark done', undone: 'Move back to To do', unsnooze: 'Unsnooze' } as const

/** One MR: title, then number, author, size and when it last changed. A click opens it. */
export function MrRow({
  row,
  selected,
  current,
  onOpen,
  onAction,
  action = 'done',
}: {
  row: QueueRow
  selected: boolean
  /** The MR open on the right. */
  current: boolean
  onOpen: () => void
  onAction: () => void
  /** The row's button: ✓ (mark done, or back to To do when done), Unsnooze (snoozed view), or none. */
  action?: 'done' | 'undone' | 'unsnooze' | null
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    // jsdom has no scrollIntoView.
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])
  const unread = row.items.some((item) => !item.read)
  const needsYou = row.attention === 'needs-you' || row.attention === 'returned'
  return (
    <article
      ref={ref}
      className={`sb-row${selected ? ' is-selected' : ''}${current ? ' is-current' : ''}${
        needsYou ? ' is-needs-you' : ''
      }${row.done ? ' is-done' : ''}`}
      aria-current={current ? 'true' : undefined}
      data-key={row.key}
      onClick={onOpen}
    >
      <div className="sb-title-line">
        <h3 className="sb-title">
          {unread ? <span className="sb-unread" aria-label="Unread" /> : null}
          <span className="sb-title-text">{row.title}</span>
        </h3>
        {action ? (
          <button
            type="button"
            className={action === 'unsnooze' ? 'sb-unsnooze' : `sb-done${action === 'undone' ? ' is-done' : ''}`}
            aria-label={`${ACTION_LABEL[action]} ${row.title}`}
            title={ACTION_LABEL[action]}
            onClick={(event) => {
              // The row opens on click; this button never does.
              event.stopPropagation()
              onAction()
            }}
          >
            {action === 'unsnooze' ? (
              'Unsnooze'
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 8.5 6.5 12 13 4.5" />
              </svg>
            )}
          </button>
        ) : null}
      </div>
      <p className="sb-meta">
        !{row.iid}
        {row.mr ? (
          <>
            {' · '}
            {row.mr.author.name}
            {' · '}
            <span className="q-plus">+{row.mr.additions}</span>{' '}
            <span className="q-minus">−{row.mr.deletions}</span>
          </>
        ) : null}
        {' · '}
        {row.mr?.state === 'merged' ? (
          <>
            <span className="sb-chip">Merged</span>{' · '}
          </>
        ) : null}
        <time dateTime={row.updatedAt} title={new Date(row.updatedAt).toLocaleString()}>
          {shortTime(row.updatedAt)}
        </time>
      </p>
    </article>
  )
}
