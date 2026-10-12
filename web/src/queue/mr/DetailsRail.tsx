import type { ReactNode } from 'react'

import type { MrOverview } from '../../gitlab/mrOverview'
import { relativeTime } from '../../hub/relativeTime'

const STATE_WORDS: Record<string, string> = {
  UNREVIEWED: 'to review',
  REVIEW_STARTED: 'reviewing',
  REVIEWED: 'reviewed',
  REQUESTED_CHANGES: 'changes requested',
  APPROVED: 'approved',
  UNAPPROVED: 'to review',
}
const PIPELINE_WORDS: Record<string, string> = {
  SUCCESS: 'passed',
  FAILED: 'failed',
  RUNNING: 'running',
  PENDING: 'pending',
  CANCELED: 'canceled',
  SKIPPED: 'skipped',
  MANUAL: 'manual',
}

/** Who reviews, what is approved, the pipeline, labels, project and commits. */
export function DetailsRail({
  overview,
  host,
  me,
  projectName,
  projectColor,
  rebase,
}: {
  overview: MrOverview
  host: string
  me: string
  projectName: string | null
  projectColor: string | null
  rebase?: ReactNode
}) {
  const pipeline = overview.pipeline
  const pipelineWord = pipeline
    ? (PIPELINE_WORDS[pipeline.status] ?? pipeline.status.toLowerCase())
    : null
  return (
    <aside className="mr-rail" aria-label="Details">
      <section>
        <h3>Reviewers</h3>
        {overview.reviewers.map((reviewer) => (
          <p key={reviewer.username} className="mr-who">
            <span>{reviewer.username === me ? 'You' : reviewer.name}</span>
            <span className={`mr-state is-${reviewer.state.toLowerCase()}`}>
              {STATE_WORDS[reviewer.state] ?? reviewer.state.toLowerCase()}
            </span>
          </p>
        ))}
        {overview.reviewers.length === 0 ? <p className="mr-muted">None</p> : null}
      </section>
      <section>
        <h3>Approvals</h3>
        <p>
          {overview.approvalsRequired
            ? `${overview.approvalsRequired - overview.approvalsLeft} of ${overview.approvalsRequired}`
            : String(overview.approvedBy.length)}
        </p>
        {overview.approvedBy.length ? (
          <p className="mr-muted">{overview.approvedBy.map((a) => a.name).join(', ')}</p>
        ) : null}
      </section>
      <section>
        <h3>Pipeline</h3>
        {pipeline && pipelineWord ? (
          pipeline.path ? (
            <a
              href={`https://${host}${pipeline.path}`}
              target="_blank"
              rel="noreferrer"
              className={`mr-pipeline is-${pipeline.status.toLowerCase()}`}
            >
              {pipelineWord}
            </a>
          ) : (
            <span className={`mr-pipeline is-${pipeline.status.toLowerCase()}`}>{pipelineWord}</span>
          )
        ) : (
          <p className="mr-muted">None</p>
        )}
      </section>
      {overview.labels.length ? (
        <section>
          <h3>Labels</h3>
          {overview.labels.map((label) => (
            <span key={label.title} className="mr-label" style={{ borderColor: label.color }}>
              {label.title}
            </span>
          ))}
        </section>
      ) : null}
      <section>
        <h3>Project</h3>
        <p>
          <span className="q-dot" style={{ background: projectColor ?? 'var(--line)' }} />
          {projectName ?? 'Unsorted'}
        </p>
      </section>
      <section>
        <h3>Commits</h3>
        <p>{overview.commitCount}</p>
        <p className="mr-muted">updated {relativeTime(overview.updatedAt)}</p>
      </section>
      {rebase}
    </aside>
  )
}
