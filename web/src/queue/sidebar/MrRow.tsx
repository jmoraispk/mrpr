import { useEffect, useRef, type ReactNode } from 'react'

import { relativeTime } from '../../hub/relativeTime'
import type { QueueRow } from '../model'
import { TagList } from '../TagList'
import type { TagKind } from '../tags'

/**
 * One MR: title, three tags, a grey line. A click expands it in place; the
 * sidebar opens it on the second click of a double-click.
 */
export function MrRow({
  row,
  order,
  selected,
  expanded,
  current,
  onToggle,
  children,
}: {
  row: QueueRow
  order: TagKind[]
  selected: boolean
  expanded: boolean
  /** The MR open on the right. */
  current: boolean
  /** A first click, with when it happened; the sidebar opens the row on the second. */
  onToggle: (at: number) => void
  /** The expanded part. */
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    // jsdom has no scrollIntoView.
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])
  const unread = row.items.some((item) => !item.read)
  return (
    <article
      ref={ref}
      className={`sb-row${selected ? ' is-selected' : ''}${expanded ? ' is-expanded' : ''}${current ? ' is-current' : ''}`}
      aria-current={current ? 'true' : undefined}
      data-key={row.key}
      // Dragging would fight selecting text in the reply box.
      draggable={!expanded}
      onDragStart={(event) => event.dataTransfer.setData('text/mrpr-row', row.key)}
      onClick={(event) => {
        if (event.detail < 2) onToggle(event.timeStamp)
      }}
    >
      <h3 className="sb-title">
        {unread ? <span className="sb-unread" aria-label="Unread" /> : null}
        <span className="sb-title-text">{row.title}</span>
      </h3>
      <TagList tags={row.tags} order={order} max={3} />
      <p className="sb-meta">
        !{row.iid}
        {row.mr ? (
          <>
            {' · '}by {row.mr.author.name}
            {' · '}
            <span className="q-plus">+{row.mr.additions}</span>{' '}
            <span className="q-minus">−{row.mr.deletions}</span>
          </>
        ) : null}
        {' · '}
        <time dateTime={row.updatedAt}>{relativeTime(row.updatedAt)}</time>
      </p>
      {expanded ? (
        // Clicks in here are the preview's own: they never fold or open the row.
        <div
          className="sb-preview"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </article>
  )
}
