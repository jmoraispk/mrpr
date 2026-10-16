import type { Discussion } from '../api/types'
import type { OverviewDiscussion, OverviewNote } from '../gitlab/mrOverview'

export type FilterKey = 'unresolved' | 'resolved' | 'commits' | 'bots' | 'other'
/** What the MR page's Activity shows: the ⚙ Show checkboxes. */
export type Filters = Record<FilterKey, boolean>
export const FILTER_KEYS: FilterKey[] = ['unresolved', 'resolved', 'commits', 'bots', 'other']
export const DEFAULT_FILTERS: Filters = {
  unresolved: true,
  resolved: false,
  commits: true,
  bots: false,
  other: true,
}

export type ActivityItem =
  | {
      kind: 'thread'
      discussion: OverviewDiscussion
      category: 'unresolved' | 'resolved' | 'bots'
      at: string
      isNew: boolean
      you: 'mentioned' | 'replied' | 'started' | null
    }
  | { kind: 'event'; note: OverviewNote; category: 'commits' | 'other'; at: string; isNew: boolean }

export interface Activity {
  items: ActivityItem[]
  /** Index of the first item newer than your last look, where the divider goes. */
  dividerBefore: number | null
  hidden: Record<'resolved' | 'bots' | 'commits' | 'other', number>
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const newer = (at: string, since: string | null) =>
  since !== null && Date.parse(at) > Date.parse(since)

function involvement(notes: OverviewNote[], me: string): 'mentioned' | 'replied' | 'started' | null {
  const mention = new RegExp(`(^|[^\\w@])@${escape(me)}(?![\\w-])`, 'i')
  if (notes.some((n) => n.author?.username !== me && mention.test(n.body))) return 'mentioned'
  if (notes[0]?.author?.username === me) return 'started'
  if (notes.some((n) => n.author?.username === me)) return 'replied'
  return null
}

/** Threads and events in time order, filtered by the Show settings. */
export function buildActivity(
  discussions: OverviewDiscussion[],
  {
    me,
    since,
    filters,
    reveal = false,
    show,
    person = null,
  }: {
    me: string
    since: string | null
    filters: Filters
    reveal?: boolean
    /** Threads to show whatever the filters say: one you are replying in, or a link went to. */
    show?: ReadonlySet<string>
    /** Only threads this username wrote in (events aside); null or absent for everyone. */
    person?: string | null
  },
): Activity {
  const all: ActivityItem[] = []
  for (const discussion of discussions) {
    const people = discussion.notes.filter((n) => !n.system)
    // One person chosen: their threads only, and no events. A thread asked for
    // by id (a reply, a link) stays.
    if (person && !show?.has(discussion.id) && !people.some((n) => n.author?.username === person)) continue
    if (people.length === 0) {
      for (const n of discussion.notes) {
        all.push({
          kind: 'event',
          note: n,
          category: n.icon === 'commit' ? 'commits' : 'other',
          at: n.createdAt,
          isNew: newer(n.createdAt, since),
        })
      }
      continue
    }
    const you = involvement(people, me)
    // A bot's thread you joined is a conversation of yours, not bot noise.
    const category =
      discussion.resolvable && discussion.resolved
        ? 'resolved'
        : people[0].author?.bot && !you
          ? 'bots'
          : 'unresolved'
    all.push({
      kind: 'thread',
      // The overview's own object, so the same data keeps the same thread.
      discussion,
      category,
      at: people[0].createdAt,
      isNew: newer(people[people.length - 1].createdAt, since),
      you,
    })
  }
  all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const hidden = { resolved: 0, bots: 0, commits: 0, other: 0 }
  const items = all.filter((item) => {
    if (reveal || filters[item.category]) return true
    if (item.kind === 'thread' && show?.has(item.discussion.id)) return true
    if (item.category !== 'unresolved') hidden[item.category] += 1
    return false
  })
  const first = since === null ? -1 : items.findIndex((item) => newer(item.at, since))
  return { items, dividerBefore: first >= 0 ? first : null, hidden }
}

/** The first note a person wrote in a thread (system notes aside). */
export function firstNote(discussion: OverviewDiscussion): OverviewNote | undefined {
  return discussion.notes.find((n) => !n.system)
}

/**
 * The thread waiting on you: the newest open one that involves you and whose
 * last word isn't yours. Read from the MR itself, so it survives the inbox
 * marking things read as you open the MR.
 */
export function waitingOnYou(discussions: OverviewDiscussion[], me: string): string | null {
  let best: { id: string; at: number } | null = null
  for (const discussion of discussions) {
    if (discussion.resolvable && discussion.resolved) continue
    const people = discussion.notes.filter((n) => !n.system)
    const last = people[people.length - 1]
    if (!last || last.author?.username === me || !involvement(people, me)) continue
    const at = Date.parse(last.createdAt)
    if (!best || at > best.at) best = { id: discussion.id, at }
  }
  return best?.id ?? null
}

const mapped = new WeakMap<OverviewDiscussion, Discussion>()

/**
 * The review view's discussion shape, so Overview threads reuse DiscussionThread.
 * The same overview thread always maps to the same object: a new object would
 * reset the thread's local state (a reply just posted) on every render.
 */
export function toThreadDiscussion(discussion: OverviewDiscussion): Discussion {
  const known = mapped.get(discussion)
  if (known) return known
  const shaped = shape(discussion)
  mapped.set(discussion, shaped)
  return shaped
}

function shape(discussion: OverviewDiscussion): Discussion {
  const notes = discussion.notes.filter((n) => !n.system)
  return {
    id: discussion.id,
    individual_note: notes.length === 1 && !discussion.resolvable,
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      author: n.author
        ? { name: n.author.name, username: n.author.username, avatar_url: n.author.avatarUrl ?? undefined }
        : undefined,
      created_at: n.createdAt,
      position: n.position
        ? {
            new_path: n.position.filePath,
            old_path: n.position.filePath,
            new_line: n.position.newLine,
            old_line: n.position.oldLine,
          }
        : null,
      resolvable: discussion.resolvable,
      resolved: discussion.resolved,
    })),
  }
}
