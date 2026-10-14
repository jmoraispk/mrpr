import type { QueueHost, QueueMr } from '../gitlab/queueFacts'
import type { InboxItem } from '../inbox/types'
import { attentionOf, type Attention, type Tag } from './tags'

/** One MR in the queue: what it asks of you, and how urgently. */
export interface QueueRow {
  key: string
  hostId: string
  host: string
  /** Null when only inbox items know about the MR (assignee-only, mentions). */
  mr: QueueMr | null
  project: string
  iid: number
  title: string
  webUrl: string
  updatedAt: string
  /** Everything that applies, in no particular order; `visibleTags` orders them for display. */
  tags: Tag[]
  attention: Attention
  /** Bot-authored: never listed, only counted. */
  folded: boolean
  /** Review time estimate from the diff size; 0 without facts. */
  minutes: number
  /** Commits since your last look, on an MR you review; 0 otherwise. */
  newCommits: number
  score: number
  items: InboxItem[]
  snoozed: boolean
}

export interface QueueInput {
  hosts: QueueHost[]
  items: InboxItem[]
  /** Row key → the MR's updatedAt when it was snoozed. */
  snoozed: Record<string, string>
  /** Row key → commits since your last look, for MRs whose head moved. */
  commitsSince: Record<string, number>
  now: Date
}

const QUICK_WIN_LINES = 30
const PENDING: ReadonlySet<string> = new Set(['UNREVIEWED', 'REVIEW_STARTED', 'UNAPPROVED'])
const HOUR = 3_600_000

export function rowKey(hostId: string, mrId: number): string {
  return `${hostId}:${mrId}`
}

/** Where the last look at an MR is stored; the review transport knows project and iid, not the MR id. */
export function lookKeyFor(hostId: string, project: string, iid: number): string {
  return `${hostId}:${project}!${iid}`
}

const isForMe = (item: InboxItem) => item.kind === 'reply' || item.kind === 'mention'

function classify(mr: QueueMr, me: string, items: InboxItem[], commits: number, now: number) {
  const unread = items.filter((item) => !item.read)
  const forMe = unread.filter(isForMe)
  const comments = unread.filter((item) => item.kind === 'comment')
  const mine = mr.reviewers.find((reviewer) => reviewer.username === me)
  const isAuthor = mr.author.username === me || mr.roles.includes('author')
  const lines = mr.additions + mr.deletions
  const minutes = Math.max(1, Math.round(lines / 25))
  const pending = Boolean(mine && PENDING.has(mine.state))
  const needsReview = pending || unread.some((item) => item.kind === 'review_requested')
  // Strict: your approval is the last one missing. GitLab's approval rules may
  // not count yours, so this is a best guess.
  const blocking =
    pending && !mr.draft && mr.approvalsLeft === 1
      ? 1 + mr.reviewers.filter((r) => r.username !== me && r.state === 'APPROVED').length
      : 0
  const tags: Tag[] = []
  if (blocking) tags.push({ kind: 'blocking', people: blocking })
  if (needsReview || forMe.length) tags.push({ kind: 'waiting-on-you' })
  if (mine?.state === 'REQUESTED_CHANGES' && commits > 0) tags.push({ kind: 'changes-addressed' })
  if (
    isAuthor &&
    (mr.reviewers.some((r) => r.state === 'REQUESTED_CHANGES') || comments.length > 0)
  ) {
    tags.push({ kind: 'returned' })
  }
  if (isAuthor && (mr.approvalsLeft > 0 || mr.reviewers.some((r) => PENDING.has(r.state)))) {
    const days = Math.floor((now - Date.parse(mr.createdAt)) / (24 * HOUR))
    tags.push({ kind: 'waiting-on-others', days: Math.max(0, days) })
  }
  if (needsReview && lines <= QUICK_WIN_LINES) tags.push({ kind: 'quick-win', minutes })
  if (isAuthor && mr.needsRebase) tags.push({ kind: 'needs-rebase' })
  // Commits matter to a reviewer; on your own MR they are your own pushes.
  return { tags, minutes, blocking, newCommits: mine ? commits : 0 }
}

/** What an MR with no facts asks of you, by what its unread inbox items say. */
function orphanTags(items: InboxItem[]): Tag[] {
  const tags: Tag[] = []
  const forMe = items.filter(isForMe)
  if (forMe.length || items.some((item) => item.kind === 'review_requested')) {
    tags.push({ kind: 'waiting-on-you' })
  }
  if (items.some((item) => item.kind === 'comment')) tags.push({ kind: 'returned' })
  return tags
}

/** Every MR as a row, in facts order; the sidebar filters, sorts and groups them. */
export function buildQueue(input: QueueInput): QueueRow[] {
  const rows: QueueRow[] = []
  const now = input.now.getTime()
  for (const host of input.hosts) {
    const hostItems = input.items.filter((item) => item.hostId === host.hostId)
    const seen = new Set<number>()
    for (const mr of host.mrs) {
      if (seen.has(mr.id)) continue
      seen.add(mr.id)
      const key = rowKey(host.hostId, mr.id)
      const items = hostItems.filter((item) => item.mrId === mr.id)
      const commits = input.commitsSince[key] ?? 0
      const { tags, minutes, blocking, newCommits } = classify(mr, host.username, items, commits, now)
      const ageHours = (now - Date.parse(mr.createdAt)) / HOUR
      const quickWin = tags.some((tag) => tag.kind === 'quick-win')
      rows.push({
        key,
        hostId: host.hostId,
        host: host.host,
        mr,
        project: mr.project,
        iid: mr.iid,
        title: mr.title,
        webUrl: mr.webUrl,
        updatedAt: mr.updatedAt,
        tags,
        attention: attentionOf(tags),
        folded: mr.author.bot,
        minutes,
        newCommits,
        score: blocking * 10 + ageHours / 6 + (quickWin ? 5 : 0) - (mr.draft ? 20 : 0),
        items,
        snoozed: input.snoozed[key] === mr.updatedAt,
      })
    }
    // Inbox items on MRs the facts query did not return (assignee-only, mentions).
    const orphans = new Map<number, InboxItem[]>()
    for (const item of hostItems) {
      if (seen.has(item.mrId) || item.read) continue
      orphans.set(item.mrId, [...(orphans.get(item.mrId) ?? []), item])
    }
    for (const [mrId, items] of orphans) {
      const first = items[0]
      const key = rowKey(host.hostId, mrId)
      const tags = orphanTags(items)
      rows.push({
        key,
        hostId: host.hostId,
        host: host.host,
        mr: null,
        project: first.project,
        iid: first.iid,
        title: first.mrTitle,
        webUrl: first.webUrl,
        updatedAt: first.createdAt,
        tags,
        attention: attentionOf(tags),
        folded: false,
        minutes: 0,
        newCommits: 0,
        score: 0,
        items,
        snoozed: input.snoozed[key] === first.createdAt,
      })
    }
  }
  return rows
}

/** Minutes of review waiting on you today: the size estimates of what needs you. */
export function todaysBudget(rows: QueueRow[]): number {
  return rows
    .filter((row) => !row.snoozed && !row.folded && row.attention === 'needs-you')
    .reduce((sum, row) => sum + row.minutes, 0)
}
