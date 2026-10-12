import type { ReviewTarget } from '../transport/types'

export type ReviewOp =
  | 'getConfig'
  | 'getMergeRequest'
  | 'getDiffs'
  | 'getDiscussions'
  | 'createDiscussion'
  | 'replyToDiscussion'
  | 'setResolved'

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

export type DeltaMessage =
  | {
      kind: 'delta/review'
      op: ReviewOp
      target: ReviewTarget
      payload?: unknown
    }
  | { kind: 'delta/hub'; op: HubOp; payload?: unknown }

export interface DeltaErrorPayload {
  code: string
  message: string
  status: number
}

export type DeltaResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: DeltaErrorPayload }
