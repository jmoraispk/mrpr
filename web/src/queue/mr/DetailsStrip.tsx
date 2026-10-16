import type { ReactNode } from 'react'

import type { MrOverview } from '../../gitlab/mrOverview'
import { When } from './When'

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

/** Who reviews, what is approved, the pipeline, commits and labels: one wrapping line under the title. */
export function DetailsStrip({
  overview,
  host,
  me,
  rebase,
}: {
  overview: MrOverview
  host: string
  me: string
  /** Rebase, when GitLab says the branch needs it. */
  rebase?: ReactNode
}) {
  const pipeline = overview.pipeline
  const word = pipeline ? (PIPELINE_WORDS[pipeline.status] ?? pipeline.status.toLowerCase()) : null
  const approvals = overview.approvalsRequired
    ? `${overview.approvalsRequired - overview.approvalsLeft} of ${overview.approvalsRequired}`
    : String(overview.approvedBy.length)
  return (
    <ul className="mr-strip" aria-label="Details">
      <li>
        <span className="mr-strip-key">Reviewers</span>
        {overview.reviewers.length ? (
          overview.reviewers.map((reviewer) => (
            <span key={reviewer.username} className="mr-who">
              <span>{reviewer.username === me ? 'You' : reviewer.name}</span>
              <span className={`mr-state is-${reviewer.state.toLowerCase()}`}>
                {STATE_WORDS[reviewer.state] ?? reviewer.state.toLowerCase()}
              </span>
            </span>
          ))
        ) : (
          <span className="mr-muted">none</span>
        )}
      </li>
      <li title={overview.approvedBy.map((a) => a.name).join(', ') || undefined}>
        <span className="mr-strip-key">Approvals</span> {approvals}
      </li>
      {pipeline && word ? (
        <li>
          <span className="mr-strip-key">Pipeline</span>{' '}
          {pipeline.path ? (
            <a
              href={`https://${host}${pipeline.path}`}
              target="_blank"
              rel="noreferrer"
              className={`mr-pipeline is-${pipeline.status.toLowerCase()}`}
            >
              {word}
            </a>
          ) : (
            <span className={`mr-pipeline is-${pipeline.status.toLowerCase()}`}>{word}</span>
          )}
        </li>
      ) : null}
      <li>
        {overview.commitCount} commit{overview.commitCount === 1 ? '' : 's'} · updated{' '}
        <When iso={overview.updatedAt} />
      </li>
      {overview.labels.map((label) => (
        <li key={label.title}>
          <span className="mr-label" style={{ borderColor: label.color }}>
            {label.title}
          </span>
        </li>
      ))}
      {rebase ? <li>{rebase}</li> : null}
    </ul>
  )
}
