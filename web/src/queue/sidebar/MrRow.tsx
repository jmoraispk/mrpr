import { useEffect, useRef } from 'react'

import { shortTime } from '../../hub/relativeTime'
import type { QueueRow } from '../model'

/** One MR: title, then number, author, size and when it last changed. A click opens it. */
export function MrRow({
  row,
  selected,
  current,
  onOpen,
  onSnooze,
  action = 'snooze',
}: {
  row: QueueRow
  selected: boolean
  /** The MR open on the right. */
  current: boolean
  onOpen: () => void
  onSnooze: () => void
  /** The row's button: snooze it, unsnooze it (snoozed view), or none. */
  action?: 'snooze' | 'unsnooze' | null
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
      }`}
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
            className="sb-snooze"
            aria-label={`${action === 'unsnooze' ? 'Unsnooze' : 'Snooze'} ${row.title}`}
            title={action === 'unsnooze' ? 'Unsnooze' : 'Snooze until it changes'}
            onClick={(event) => {
              // The row opens on click; this button never does.
              event.stopPropagation()
              onSnooze()
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 7h5l-5 6h5" />
              <path d="M9 2h5l-5 6h5" />
              {action === 'unsnooze' ? <path d="M1.5 14.5 14.5 1.5" /> : null}
            </svg>
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
