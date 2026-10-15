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
}: {
  row: QueueRow
  selected: boolean
  /** The MR open on the right. */
  current: boolean
  onOpen: () => void
  onSnooze: () => void
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
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/mrpr-row', row.key)}
      onClick={onOpen}
    >
      <div className="sb-title-line">
        <h3 className="sb-title">
          {unread ? <span className="sb-unread" aria-label="Unread" /> : null}
          <span className="sb-title-text">{row.title}</span>
        </h3>
        <button
          type="button"
          className="sb-snooze"
          aria-label={`Snooze ${row.title}`}
          title="Snooze until it changes"
          onClick={(event) => {
            // The row opens on click; this button never does.
            event.stopPropagation()
            onSnooze()
          }}
        >
          💤
        </button>
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
        <time dateTime={row.updatedAt} title={new Date(row.updatedAt).toLocaleString()}>
          {shortTime(row.updatedAt)}
        </time>
      </p>
    </article>
  )
}
