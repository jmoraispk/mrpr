import {
  fetchActivity,
  fetchCommentedMergeRequestIds,
  fetchInvolved,
  type ActivityNote,
  type Role,
} from '../gitlab/activity'
import type { GitLabClient } from '../gitlab/client'
import { classify, reviewRequestedItem } from './classify'
import type { HostInbox, InboxItem, TrackedMergeRequest } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

/** On a host's first poll, notes this recent become items; older ones are seen. */
export const FIRST_RUN_WINDOW_MS = 3 * DAY_MS
/** How long a merge request is watched after it leaves every open list. */
export const TRACK_AFTER_LEAVING_MS = 14 * DAY_MS
/** The user's own comments change slowly; read them at most this often. */
export const EVENTS_INTERVAL_MS = 15 * 60 * 1000
export const ITEM_CAP = 500
/**
 * Slack on the cut for a merge request that just joined. GitLab raises a
 * mention todo in a background job, a moment after the note, and the local
 * clock may run ahead of GitLab's. Item ids are stable, so reading a little
 * too far back can never duplicate an item.
 */
export const JOIN_MARGIN_MS = 10 * 60 * 1000

export interface PollHostInput {
  client: GitLabClient
  hostId: string
  username: string
  previous: HostInbox | null
  now: Date
  hideBots: boolean
  signal?: AbortSignal
}

export function emptyHostInbox(): HostInbox {
  return { lastPollAt: null, lastEventsAt: null, mrs: {}, items: [], error: null }
}

export function mergeItems(
  existing: InboxItem[],
  incoming: InboxItem[],
): InboxItem[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, ITEM_CAP)
}

function withRole(roles: Role[], role: Role): Role[] {
  return roles.includes(role) ? roles : [...roles, role]
}

export async function pollHost(input: PollHostInput): Promise<HostInbox> {
  const { client, hostId, username, now, hideBots, signal } = input
  const previous = input.previous ?? emptyHostInbox()
  const at = now.getTime()
  const firstPoll = previous.lastPollAt === null
  const until = new Date(at + TRACK_AFTER_LEAVING_MS).toISOString()
  const live = (mr: TrackedMergeRequest) =>
    mr.trackedUntil === null || Date.parse(mr.trackedUntil) > at
  const watched = Object.values(previous.mrs).filter(live)

  // Merge requests watched outside the lists ride along in the same query, so
  // a quiet poll stays one request.
  const involved = await fetchInvolved(
    client,
    watched.filter((mr) => mr.trackedUntil !== null).map((mr) => mr.id),
    signal,
  )

  const eventsDue =
    previous.lastEventsAt === null ||
    at - Date.parse(previous.lastEventsAt) >= EVENTS_INTERVAL_MS
  const commented = eventsDue
    ? await fetchCommentedMergeRequestIds(
        client,
        previous.lastEventsAt
          ? new Date(previous.lastEventsAt)
          : new Date(at - TRACK_AFTER_LEAVING_MS),
        signal,
      )
    : []

  const next: Record<string, TrackedMergeRequest> = {}
  const changed = new Set<number>()

  for (const mr of involved.listed) {
    const before = previous.mrs[mr.id]
    const kept = before && live(before) ? before : undefined
    next[mr.id] = {
      ...mr,
      roles: kept?.roles.includes('commenter')
        ? withRole(mr.roles, 'commenter')
        : mr.roles,
      maxSeenNoteId: kept?.maxSeenNoteId ?? 0,
      trackedUntil: null,
    }
    if (!kept || kept.updatedAt !== mr.updatedAt) changed.add(mr.id)
  }

  for (const mr of watched) {
    if (next[mr.id]) continue
    if (mr.trackedUntil === null) {
      // It just left every list: merged, closed, or the user was taken off
      // it. Read it once more to learn why, then keep watching for a while.
      next[mr.id] = { ...mr, trackedUntil: until }
      changed.add(mr.id)
      continue
    }
    const seen = involved.extra[mr.id]
    if (!seen) continue // Deleted, or no longer visible to this user.
    next[mr.id] = { ...mr }
    if (seen.updatedAt !== mr.updatedAt) changed.add(mr.id)
  }

  for (const id of commented) {
    const existing = next[id]
    if (!existing) {
      changed.add(id)
      continue
    }
    existing.roles = withRole(existing.roles, 'commenter')
    if (existing.trackedUntil !== null) existing.trackedUntil = until
  }

  const activity =
    changed.size > 0
      ? await fetchActivity(client, [...changed], signal)
      : new Map()
  // A merge request found through the user's own comments is found up to
  // one events interval late, so read it from the last events check, not the
  // last poll: a reply in that gap is still unseen.
  const since = firstPoll
    ? at - FIRST_RUN_WINDOW_MS
    : Math.min(
        Date.parse(previous.lastPollAt as string),
        previous.lastEventsAt ? Date.parse(previous.lastEventsAt) : Infinity,
      ) - JOIN_MARGIN_MS
  const items: InboxItem[] = []

  for (const id of changed) {
    const mr = activity.get(id)
    if (!mr) {
      delete next[id]
      continue
    }
    const before = previous.mrs[id]
    const known = before && live(before) ? before : undefined
    // Absent for a merge request found only through the user's own comments.
    const base = next[id] as TrackedMergeRequest | undefined
    const tracked: TrackedMergeRequest = {
      roles: base?.roles ?? ['commenter'],
      maxSeenNoteId: base?.maxSeenNoteId ?? 0,
      trackedUntil: base ? base.trackedUntil : until,
      id: mr.id,
      iid: mr.iid,
      project: mr.project,
      title: mr.title,
      webUrl: mr.webUrl,
      updatedAt: mr.updatedAt,
    }
    // A merge request seen before is read from the last note seen. One that
    // just joined is read from shortly before the last poll (see `since`), so
    // a mention that arrived with it is not lost and its history is not
    // replayed.
    const isNew = known
      ? (note: ActivityNote) => note.id > known.maxSeenNoteId
      : (note: ActivityNote) => Date.parse(note.createdAt) > since
    items.push(
      ...classify({ hostId, username, mr, roles: tracked.roles, isNew, hideBots }),
    )
    for (const discussion of mr.discussions) {
      for (const note of discussion.notes) {
        if (note.id > tracked.maxSeenNoteId) tracked.maxSeenNoteId = note.id
      }
    }
    next[id] = tracked
  }

  if (!firstPoll) {
    for (const mr of involved.listed) {
      if (!mr.roles.includes('reviewer')) continue
      if (previous.mrs[mr.id]?.roles.includes('reviewer')) continue
      items.push(reviewRequestedItem(hostId, mr))
    }
  }

  return {
    lastPollAt: now.toISOString(),
    lastEventsAt: eventsDue ? now.toISOString() : previous.lastEventsAt,
    mrs: next,
    items: mergeItems(previous.items, items),
    error: null,
  }
}
