import type { GitLabClient } from './client'

export type ReviewState =
  | 'UNREVIEWED'
  | 'REVIEWED'
  | 'REQUESTED_CHANGES'
  | 'APPROVED'
  | 'UNAPPROVED'
  | 'REVIEW_STARTED'

/** One open MR you authored or were asked to review, with what the queue ranks it by. */
export interface QueueMr {
  id: number
  iid: number
  project: string
  title: string
  webUrl: string
  createdAt: string
  updatedAt: string
  roles: ('author' | 'reviewer')[]
  draft: boolean
  approved: boolean
  approvalsLeft: number
  author: { username: string; name: string; avatarUrl: string | null; bot: boolean }
  reviewers: { username: string; name: string; state: ReviewState }[]
  additions: number
  deletions: number
  files: number
  pipeline: string | null
  labels: string[]
  headSha: string | null
  /** Behind its target on a project that needs rebasing (your own MRs show it). */
  needsRebase: boolean
}

/** One signed-in host's queue MRs, or why they could not be fetched. */
export interface QueueHost {
  hostId: string
  host: string
  username: string
  mrs: QueueMr[]
  error: string | null
}

const FIELDS = `id iid title webUrl createdAt updatedAt project { fullPath } draft approved approvalsLeft
  author { username name avatarUrl bot }
  reviewers { nodes { username name mergeRequestInteraction { reviewState } } }
  diffStatsSummary { additions deletions fileCount } headPipeline { status }
  labels { nodes { title } } diffHeadSha shouldBeRebased`

/**
 * Measured against GitLab's complexity budget: 200 for both lists (with shouldBeRebased), under the
 * default limit of 250. Kept apart from the per-poll query for that reason.
 */
const QUERY = `query Facts {
  currentUser {
    authored: authoredMergeRequests(state: opened, first: 100, sort: UPDATED_DESC) { nodes { ${FIELDS} } }
    reviewing: reviewRequestedMergeRequests(state: opened, first: 100, sort: UPDATED_DESC) { nodes { ${FIELDS} } }
  }
}`

interface RawMr {
  id: string
  iid: string
  title: string
  webUrl: string
  createdAt: string
  updatedAt: string
  project: { fullPath: string }
  draft: boolean
  approved: boolean
  approvalsLeft: number | null
  author: { username: string; name: string; avatarUrl: string | null; bot: boolean | null } | null
  reviewers: {
    nodes: {
      username: string
      name: string
      mergeRequestInteraction: { reviewState: ReviewState } | null
    }[]
  }
  diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
  headPipeline: { status: string } | null
  labels: { nodes: { title: string }[] }
  diffHeadSha: string | null
  shouldBeRebased: boolean | null
}

const numericId = (gid: string) => Number(gid.slice(gid.lastIndexOf('/') + 1))

function toQueueMr(raw: RawMr): QueueMr {
  const reviewers = new Map<string, QueueMr['reviewers'][number]>()
  for (const node of raw.reviewers.nodes) {
    // A later entry for the same person replaces an earlier one.
    reviewers.set(node.username, {
      username: node.username,
      name: node.name,
      state: node.mergeRequestInteraction?.reviewState ?? 'UNREVIEWED',
    })
  }
  return {
    id: numericId(raw.id),
    iid: Number(raw.iid),
    project: raw.project.fullPath,
    title: raw.title,
    webUrl: raw.webUrl,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    roles: [],
    draft: raw.draft,
    approved: raw.approved,
    approvalsLeft: raw.approvalsLeft ?? 0,
    author: {
      username: raw.author?.username ?? '',
      name: raw.author?.name ?? '',
      avatarUrl: raw.author?.avatarUrl ?? null,
      bot: Boolean(raw.author?.bot),
    },
    reviewers: [...reviewers.values()],
    additions: raw.diffStatsSummary?.additions ?? 0,
    deletions: raw.diffStatsSummary?.deletions ?? 0,
    files: raw.diffStatsSummary?.fileCount ?? 0,
    pipeline: raw.headPipeline?.status ?? null,
    labels: raw.labels.nodes.map((label) => label.title),
    headSha: raw.diffHeadSha,
    needsRebase: Boolean(raw.shouldBeRebased),
  }
}

export async function fetchQueueMrs(
  client: GitLabClient,
  signal?: AbortSignal,
): Promise<QueueMr[]> {
  const data = await client.graphql<{
    currentUser: { authored: { nodes: RawMr[] }; reviewing: { nodes: RawMr[] } }
  }>(QUERY, {}, signal)
  const byId = new Map<number, QueueMr>()
  const add = (raw: RawMr, role: 'author' | 'reviewer') => {
    const mr = byId.get(numericId(raw.id)) ?? toQueueMr(raw)
    if (!mr.roles.includes(role)) mr.roles.push(role)
    byId.set(mr.id, mr)
  }
  for (const raw of data.currentUser.authored.nodes) add(raw, 'author')
  for (const raw of data.currentUser.reviewing.nodes) add(raw, 'reviewer')
  return [...byId.values()]
}
