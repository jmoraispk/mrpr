import type { MrOverview } from '../gitlab/mrOverview'
import type {
  DeltaConfig,
  DiffFile,
  Discussion,
  DiscussionNote,
  MergeRequest,
  PostingResult,
} from '../api/types'
import type { BackendSelection } from '../review/selection'

export interface ReviewTarget {
  hostId: string
  project: string
  iid: number
}

export interface InlineCommentInput extends BackendSelection {
  body: string
}

export interface DeltaTransport {
  /** Stable identity of the merge request this transport is bound to. */
  readonly targetKey: string
  getConfig(): Promise<DeltaConfig>
  getMergeRequest(signal?: AbortSignal): Promise<MergeRequest>
  getDiffs(signal?: AbortSignal): Promise<DiffFile[]>
  getDiscussions(signal?: AbortSignal): Promise<Discussion[]>
  createDiscussion(input: InlineCommentInput): Promise<PostingResult>
  replyToDiscussion(
    discussionId: string,
    body: string,
  ): Promise<DiscussionNote>
  setResolved(discussionId: string, resolved: boolean): Promise<Discussion>
  /** Queue actions; only the GitLab-backed transport has them. */
  approve?(): Promise<void>
  unapprove?(): Promise<void>
  /** A new MR-level discussion (request changes, nudge). */
  postComment?(body: string): Promise<Discussion>
  /** The diff from `from` to the MR's current head. */
  getDiffsSince?(from: string, signal?: AbortSignal): Promise<DiffFile[]>
  /** The diff between two commits of this MR's project, e.g. a comment's base and head. */
  getDiffsBetween?(from: string, to: string, signal?: AbortSignal): Promise<DiffFile[]>
  commitsSince?(sha: string): Promise<number>
  /** The head you last reviewed in this browser, if any. */
  lastLook?(): Promise<string | null>
  markLooked?(headSha: string): Promise<void>
  /** The MR page's overview: description, people, status and every thread. */
  getOverview?(signal?: AbortSignal): Promise<MrOverview>
  /** Ask GitLab to rebase the source branch. */
  rebase?(): Promise<void>
}
