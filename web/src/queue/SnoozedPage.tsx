import type { QueueRow } from './model'
import { reviewHash } from './route'

/**
 * MRs you snoozed: each comes back by itself when it changes, or now with
 * Unsnooze. Then the repositories you muted, until you unmute them.
 */
export function SnoozedPage({
  rows,
  onUnsnooze,
  muted,
  onUnmute,
}: {
  rows: QueueRow[]
  onUnsnooze: (row: QueueRow) => void
  /** Muted repository group id → its path. */
  muted: Record<string, string>
  onUnmute: (id: string) => void
}) {
  const snoozed = rows.filter((row) => row.snoozed && !row.folded)
  return (
    <section className="q-page" aria-label="Snoozed">
      <h2>Snoozed</h2>
      <p className="q-page-note">Each comes back by itself when the MR changes.</p>
      {snoozed.length === 0 ? (
        <p className="q-empty">Nothing snoozed.</p>
      ) : (
        <ul className="q-page-list">
          {snoozed.map((row) => (
            <li key={row.key}>
              <a href={reviewHash({ hostId: row.hostId, project: row.project, iid: row.iid })}>
                {row.title}
              </a>
              <span className="q-page-ref">
                {row.project} !{row.iid}
              </span>
              <button type="button" onClick={() => onUnsnooze(row)}>
                Unsnooze
              </button>
            </li>
          ))}
        </ul>
      )}
      {Object.keys(muted).length ? (
        <section className="q-page-section" aria-label="Muted repositories">
          <h3>Muted repositories</h3>
          <p className="q-page-note">Hidden from the list until you unmute them.</p>
          <ul className="q-page-list">
            {Object.entries(muted).map(([id, name]) => (
              <li key={id}>
                <span>{name}</span>
                <button type="button" onClick={() => onUnmute(id)}>
                  Unmute
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  )
}
