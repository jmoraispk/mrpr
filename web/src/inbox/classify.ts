import type {
  ActivityDiscussion,
  ActivityNote,
  MergeRequestActivity,
  MergeRequestRef,
  Role,
} from '../gitlab/activity'
import type { InboxItem, InboxKind } from './types'

const EXCERPT_LENGTH = 140

export interface ClassifyInput {
  hostId: string
  username: string
  mr: MergeRequestActivity
  roles: Role[]
  isNew: (note: ActivityNote) => boolean
  hideBots: boolean
}

function sameUser(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase()
}

function mentions(body: string, username: string): boolean {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Not preceded by a word character (an email address) and not followed by
  // one (a longer username that starts the same way).
  return new RegExp(`(^|[^\\w@/])@${escaped}(?![\\w-]|\\.\\w)`, 'i').test(body)
}

export function excerpt(body: string): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > EXCERPT_LENGTH
    ? `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
    : text
}

function stateKind(body: string, roles: Role[]): InboxKind | null {
  const text = body.trim()
  const mine = roles.includes('author')
  if (/^merged\b/.test(text)) {
    return mine || roles.includes('reviewer') ? 'merged' : null
  }
  if (/^approved this merge request\b/.test(text)) return mine ? 'approved' : null
  if (/^closed\b/.test(text)) return mine ? 'closed' : null
  return null
}

function noteKind(
  note: ActivityNote,
  discussion: ActivityDiscussion,
  input: ClassifyInput,
): InboxKind | null {
  const participated = discussion.notes.some(
    (other) =>
      other.id < note.id &&
      !other.system &&
      sameUser(other.author?.username, input.username),
  )
  if (participated) return 'reply'
  if (mentions(note.body, input.username)) return 'mention'
  if (input.roles.includes('author')) return 'comment'
  return null
}

/** New notes on one merge request that need the user, as inbox items. */
export function classify(input: ClassifyInput): InboxItem[] {
  const origin = `https://${input.hostId}`
  const items: InboxItem[] = []
  for (const discussion of input.mr.discussions) {
    for (const note of discussion.notes) {
      if (!input.isNew(note)) continue
      if (sameUser(note.author?.username, input.username)) continue
      if (input.hideBots && note.author?.bot) continue
      const kind = note.system
        ? stateKind(note.body, input.roles)
        : noteKind(note, discussion, input)
      if (!kind) continue
      items.push({
        id: `${input.hostId}:${note.id}`,
        kind,
        hostId: input.hostId,
        mrId: input.mr.id,
        project: input.mr.project,
        iid: input.mr.iid,
        mrTitle: input.mr.title,
        discussionId: note.system ? null : discussion.id,
        noteId: note.system ? null : note.id,
        author: note.author
          ? {
              name: note.author.name,
              username: note.author.username,
              avatarUrl: note.author.avatarUrl
                ? new URL(note.author.avatarUrl, origin).toString()
                : null,
            }
          : null,
        excerpt: note.system ? '' : excerpt(note.body),
        createdAt: note.createdAt,
        webUrl: note.url || input.mr.webUrl,
        read: false,
      })
    }
  }
  return items
}

export function reviewRequestedItem(
  hostId: string,
  mr: MergeRequestRef,
): InboxItem {
  return {
    id: `${hostId}:review:${mr.id}`,
    kind: 'review_requested',
    hostId,
    mrId: mr.id,
    project: mr.project,
    iid: mr.iid,
    mrTitle: mr.title,
    discussionId: null,
    noteId: null,
    author: null,
    excerpt: '',
    createdAt: mr.updatedAt,
    webUrl: mr.webUrl,
    read: false,
  }
}
