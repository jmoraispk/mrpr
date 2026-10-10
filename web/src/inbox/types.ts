import type { Role } from '../gitlab/activity'

export type InboxKind =
  | 'reply'
  | 'mention'
  | 'comment'
  | 'merged'
  | 'approved'
  | 'closed'
  | 'review_requested'

export interface InboxAuthor {
  name: string
  username: string
  avatarUrl: string | null
}

export interface InboxItem {
  /** `hostId:noteId`, or `hostId:review:mrId`, so a repeat poll never duplicates. */
  id: string
  kind: InboxKind
  hostId: string
  mrId: number
  project: string
  iid: number
  mrTitle: string
  /** REST discussion id; null for state changes and review requests. */
  discussionId: string | null
  noteId: number | null
  author: InboxAuthor | null
  excerpt: string
  createdAt: string
  webUrl: string
  read: boolean
}

export interface TrackedMergeRequest {
  id: number
  iid: number
  project: string
  title: string
  webUrl: string
  updatedAt: string
  roles: Role[]
  /** Notes with a higher id than this are new. */
  maxSeenNoteId: number
  /** null while an open list holds it; otherwise when to stop watching (ISO). */
  trackedUntil: string | null
}

export interface HostInbox {
  lastPollAt: string | null
  lastEventsAt: string | null
  /** Keyed by `String(mergeRequest.id)`. */
  mrs: Record<string, TrackedMergeRequest>
  /** Newest first. */
  items: InboxItem[]
  error: { code: string; message: string } | null
}

export interface InboxState {
  hosts: Record<string, HostInbox>
}

export interface InboxSettings {
  hideBots: boolean
}

export const DEFAULT_SETTINGS: InboxSettings = { hideBots: true }

export interface InboxHostStatus {
  hostId: string
  host: string
  lastPollAt: string | null
  error: { code: string; message: string } | null
}

/** What the hub is handed: every configured host's items, merged. */
export interface InboxView {
  hosts: InboxHostStatus[]
  items: InboxItem[]
  unread: number
}

/**
 * A catch-up poll (returning to the machine, opening the hub) is skipped for a
 * host polled more recently than this.
 */
export const ACTIVE_POLL_MAX_AGE_MS = 60_000
