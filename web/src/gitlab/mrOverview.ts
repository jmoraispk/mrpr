import type { GitLabClient } from './client'
import { GitLabError } from './errors'
import type { ReviewState } from './queueFacts'

export interface OverviewAuthor {
  username: string
  name: string
  avatarUrl: string | null
  bot: boolean
}

export interface OverviewNote {
  id: number
  body: string
  system: boolean
  /** GitLab's systemNoteIconName: 'commit' for pushed commits. */
  icon: string | null
  createdAt: string
  author: OverviewAuthor | null
  position: { filePath: string; newLine: number | null; oldLine: number | null } | null
}

/** A thread, with REST ids so replies and resolves use the existing review ops. */
export interface OverviewDiscussion {
  id: string
  resolvable: boolean
  resolved: boolean
  notes: OverviewNote[]
}

/** Everything the MR page shows before the code. */
export interface MrOverview {
  iid: number
  title: string
  description: string
  draft: boolean
  state: string
  createdAt: string
  updatedAt: string
  sourceBranch: string
  targetBranch: string
  webUrl: string
  headSha: string | null
  commitCount: number
  author: OverviewAuthor | null
  reviewers: { username: string; name: string; avatarUrl: string | null; state: ReviewState }[]
  approvedBy: { username: string; name: string }[]
  approvalsRequired: number
  approvalsLeft: number
  pipeline: { status: string; path: string | null } | null
  labels: { title: string; color: string }[]
  additions: number
  deletions: number
  files: number
  shouldBeRebased: boolean
  rebaseInProgress: boolean
  canPush: boolean
  discussions: OverviewDiscussion[]
}

const PAGE = 100
const DISCUSSION_FIELDS = `pageInfo { hasNextPage endCursor }
  nodes { id resolvable resolved notes { nodes { id body system systemNoteIconName createdAt
    author { username name avatarUrl bot } position { filePath newLine oldLine } } } }`

/** Verified on gitlab-master 17.7: complexity 94 (GitLab's default limit is 250). */
const QUERY = `query MrOverview($project: ID!, $iid: String!) {
  project(fullPath: $project) { mergeRequest(iid: $iid) {
    iid title description draft state createdAt updatedAt sourceBranch targetBranch webUrl
    diffHeadSha commitCount
    author { username name avatarUrl bot }
    reviewers { nodes { username name avatarUrl mergeRequestInteraction { reviewState } } }
    approvedBy { nodes { username name } } approvalsRequired approvalsLeft
    headPipeline { status path } labels { nodes { title color } }
    diffStatsSummary { additions deletions fileCount }
    shouldBeRebased rebaseInProgress userPermissions { pushToSourceBranch }
    discussions(first: ${PAGE}) { ${DISCUSSION_FIELDS} }
  } }
}`

const MORE = `query MrOverviewMore($project: ID!, $iid: String!, $after: String) {
  project(fullPath: $project) { mergeRequest(iid: $iid) {
    discussions(first: ${PAGE}, after: $after) { ${DISCUSSION_FIELDS} }
  } }
}`

interface RawAuthor {
  username: string
  name: string
  avatarUrl: string | null
  bot: boolean | null
}

interface RawNote {
  id: string
  body: string
  system: boolean
  systemNoteIconName: string | null
  createdAt: string
  author: RawAuthor | null
  position: { filePath: string; newLine: number | null; oldLine: number | null } | null
}

interface RawDiscussionPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: { id: string; resolvable: boolean; resolved: boolean; notes: { nodes: RawNote[] } }[]
}

interface RawMr {
  iid: string
  title: string
  description: string | null
  draft: boolean
  state: string
  createdAt: string
  updatedAt: string
  sourceBranch: string
  targetBranch: string
  webUrl: string
  diffHeadSha: string | null
  commitCount: number | null
  author: RawAuthor | null
  reviewers: {
    nodes: (RawAuthor & { mergeRequestInteraction: { reviewState: ReviewState } | null })[]
  }
  approvedBy: { nodes: { username: string; name: string }[] }
  approvalsRequired: number | null
  approvalsLeft: number | null
  headPipeline: { status: string; path: string | null } | null
  labels: { nodes: { title: string; color: string }[] }
  diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
  shouldBeRebased: boolean | null
  rebaseInProgress: boolean | null
  userPermissions: { pushToSourceBranch: boolean } | null
  discussions: RawDiscussionPage
}

interface Response<T> {
  project: { mergeRequest: T | null } | null
}

const suffix = (gid: string) => gid.slice(gid.lastIndexOf('/') + 1)

function toAuthor(raw: RawAuthor | null): OverviewAuthor | null {
  return raw
    ? { username: raw.username, name: raw.name, avatarUrl: raw.avatarUrl, bot: Boolean(raw.bot) }
    : null
}

function toDiscussions(page: RawDiscussionPage): OverviewDiscussion[] {
  return page.nodes.map((node) => ({
    id: suffix(node.id),
    resolvable: node.resolvable,
    resolved: node.resolved,
    notes: node.notes.nodes.map((note) => ({
      id: Number(suffix(note.id)),
      body: note.body,
      system: note.system,
      icon: note.systemNoteIconName,
      createdAt: note.createdAt,
      author: toAuthor(note.author),
      position: note.position,
    })),
  }))
}

export async function fetchMrOverview(
  client: GitLabClient,
  project: string,
  iid: number,
  signal?: AbortSignal,
): Promise<MrOverview> {
  const variables = { project, iid: String(iid) }
  const data = await client.graphql<Response<RawMr>>(QUERY, variables, signal)
  const raw = data.project?.mergeRequest
  if (!raw) {
    throw new GitLabError(404, 'This merge request is gone or you no longer have access', 'not_found')
  }
  const discussions = toDiscussions(raw.discussions)
  let page = raw.discussions
  while (page.pageInfo.hasNextPage) {
    const more = await client.graphql<Response<{ discussions: RawDiscussionPage }>>(
      MORE,
      { ...variables, after: page.pageInfo.endCursor },
      signal,
    )
    const next = more.project?.mergeRequest?.discussions
    if (!next) break
    page = next
    discussions.push(...toDiscussions(page))
  }
  return {
    iid: Number(raw.iid),
    title: raw.title,
    description: raw.description ?? '',
    draft: raw.draft,
    state: raw.state,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sourceBranch: raw.sourceBranch,
    targetBranch: raw.targetBranch,
    webUrl: raw.webUrl,
    headSha: raw.diffHeadSha,
    commitCount: raw.commitCount ?? 0,
    author: toAuthor(raw.author),
    reviewers: raw.reviewers.nodes.map((reviewer) => ({
      username: reviewer.username,
      name: reviewer.name,
      avatarUrl: reviewer.avatarUrl,
      state: reviewer.mergeRequestInteraction?.reviewState ?? 'UNREVIEWED',
    })),
    approvedBy: raw.approvedBy.nodes,
    approvalsRequired: raw.approvalsRequired ?? 0,
    approvalsLeft: raw.approvalsLeft ?? 0,
    pipeline: raw.headPipeline
      ? { status: raw.headPipeline.status, path: raw.headPipeline.path ?? null }
      : null,
    labels: raw.labels.nodes,
    additions: raw.diffStatsSummary?.additions ?? 0,
    deletions: raw.diffStatsSummary?.deletions ?? 0,
    files: raw.diffStatsSummary?.fileCount ?? 0,
    shouldBeRebased: Boolean(raw.shouldBeRebased),
    rebaseInProgress: Boolean(raw.rebaseInProgress),
    canPush: Boolean(raw.userPermissions?.pushToSourceBranch),
    discussions,
  }
}
