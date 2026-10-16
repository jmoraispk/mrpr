import type { ReviewTarget } from '../transport/types'

export type ReviewOp =
  | 'getConfig'
  | 'getMergeRequest'
  | 'getDiffs'
  | 'getDiscussions'
  | 'createDiscussion'
  | 'replyToDiscussion'
  | 'setResolved'
  | 'approve'
  | 'unapprove'
  | 'postComment'
  | 'getDiffsSince'
  | 'getDiffsBetween'
  | 'commitsSince'
  | 'getOverview'
  | 'rebase'

export type HubOp =
  | 'listHosts'
  | 'addHost'
  | 'removeHost'
  | 'listMergeRequests'
  | 'listInbox'
  | 'markRead'
  | 'markAllRead'
  | 'pollNow'
  | 'listQueue'
  | 'listRepoMrs'

export type MrprMessage =
  | {
      kind: 'mrpr/review'
      op: ReviewOp
      target: ReviewTarget
      payload?: unknown
    }
  | { kind: 'mrpr/hub'; op: HubOp; payload?: unknown }

export interface MrprErrorPayload {
  code: string
  message: string
  status: number
}

export type MrprResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: MrprErrorPayload }
