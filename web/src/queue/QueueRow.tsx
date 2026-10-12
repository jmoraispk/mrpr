import { relativeTime } from '../hub/relativeTime'
import { Badges } from './Badges'
import type { QueueRow as Row } from './model'
import type { Project } from './projects'

export function QueueRow({
  row,
  rank,
  project,
  selected,
  onSelect,
}: {
  row: Row
  rank: number | null
  project: Project | null
  selected: boolean
  onSelect: () => void
}) {
  return (
    <article
      className={`q-row${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      data-key={row.key}
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/mrpr-row', row.key)}
    >
      <span className={`q-rank${rank === 1 ? ' is-first' : ''}`} aria-hidden="true">
        {rank ?? ''}
      </span>
      <div className="q-main">
        <div className="q-title-line">
          <h3 className="q-title">{row.title}</h3>
          <time className="q-age" dateTime={row.updatedAt}>
            {relativeTime(row.updatedAt)}
          </time>
        </div>
        <div className="q-meta">
          {project ? (
            <span className="q-project">
              <span className="q-dot" style={{ background: project.color }} />
              {project.name}
            </span>
          ) : null}
          <span className="q-ref">
            {row.project} !{row.iid}
          </span>
          <Badges badges={row.badges} />
          {row.mr ? (
            <span className="q-stats">
              <span className="q-plus">+{row.mr.additions}</span>{' '}
              <span className="q-minus">−{row.mr.deletions}</span>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}
