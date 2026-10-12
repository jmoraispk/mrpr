import { Fragment } from 'react'

import { BUCKET_LABELS, type QueueRow as Row } from './model'
import { projectOf, type Project } from './projects'
import { QueueRow } from './QueueRow'

export function QueueList({
  rows,
  projects,
  selectedKey,
  onSelect,
  heading,
  grouped = false,
  compact = false,
}: {
  rows: Row[]
  projects: Project[]
  selectedKey: string | null
  onSelect: (key: string) => void
  heading: string
  /** Label each bucket, for a project's view that spans them all. */
  grouped?: boolean
  /** One-line rows, beside an open MR. */
  compact?: boolean
}) {
  // The caller decides what to list; snoozed rows appear only on their own list.
  const visible = rows
  return (
    <section className="q-list" aria-label={heading}>
      <header className="q-list-head">
        <h2>{heading}</h2>
        <span className="q-sort">sorted by: who's blocked</span>
      </header>
      {visible.length === 0 ? <p className="q-empty">Nothing here. Nice.</p> : null}
      {visible.map((row, index) => (
        <Fragment key={row.key}>
          {grouped && row.bucket !== visible[index - 1]?.bucket ? (
            <h3 className="q-group">{BUCKET_LABELS[row.bucket]}</h3>
          ) : null}
          <QueueRow
            row={row}
            rank={row.bucket === 'needs-you' || row.bucket === 'quick-wins' ? index + 1 : null}
            project={projectOf(row, projects)}
            selected={row.key === selectedKey}
            onSelect={() => onSelect(row.key)}
            compact={compact}
          />
        </Fragment>
      ))}
      {compact ? null : (
      <p className="q-keys" aria-hidden="true">
        <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>r</kbd> reply ·{' '}
        <kbd>x</kbd> request changes · <kbd>d</kbd> since last review · <kbd>s</kbd> snooze ·{' '}
        <kbd>Enter</kbd> open · <kbd>?</kbd> all keys
      </p>
      )}
    </section>
  )
}
