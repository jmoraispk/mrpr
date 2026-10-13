import type { QueueHost, QueueMr } from '../gitlab/queueFacts'
import type { InboxItem } from '../inbox/types'
import { attentionOf, type Attention, type Tag } from './tags'

export type Bucket = 'needs-you' | 'quick-wins' | 'returned' | 'waiting' | 'done' | 'folded'

export type Badge =
  | { kind: 'needs-rebase' }
  | { kind: 'commits-since'; count: number }
  | { kind: 'threads-waiting'; count: number }
  | { kind: 'pipeline-failed' }
  | { kind: 'draft' }
  | { kind: 'ai-authored' }
  | { kind: 'size'; size: 'S' | 'M' | 'L'; minutes: number }
  | { kind: 'waiting-on'; names: string[]; days: number }
  | { kind: 'changes-addressed' }

/** One MR in the queue: where it goes, how high, and why. */
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
  bucket: Bucket
  score: number
  badges: Badge[]
  /** Everything that applies, in no particular order; `visibleTags` orders them for display. */
  tags: Tag[]
  attention: Attention
  /** Bot-authored: never listed, only counted. */
  folded: boolean
  /** Review time estimate from the diff size; 0 without facts. */
  minutes: number
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

export const BUCKET_ORDER: Bucket[] = [
  'needs-you',
  'quick-wins',
  'returned',
  'waiting',
  'done',
  'folded',
]
export const BUCKET_LABELS: Record<Bucket, string> = {
  'needs-you': 'Needs you',
  'quick-wins': 'Quick wins',
  returned: 'Returned to you',
  waiting: 'Waiting on others',
  done: 'Done',
  folded: 'Folded',
}

const QUICK_WIN_LINES = 30
const PENDING: ReadonlySet<string> = new Set(['UNREVIEWED', 'REVIEW_STARTED', 'UNAPPROVED'])
const AGENT_LABEL = /agent|\bai\b|bot/i
const HOUR = 3_600_000

export function rowKey(hostId: string, mrId: number): string {
  return `${hostId}:${mrId}`
}

/** Where the last look at an MR is stored; the review transport knows project and iid, not the MR id. */
export function lookKeyFor(hostId: string, project: string, iid: number): string {
  return `${hostId}:${project}!${iid}`
}

function sizeBadge(lines: number): Badge {
  return {
    kind: 'size',
    size: lines <= 100 ? 'S' : lines <= 500 ? 'M' : 'L',
    minutes: Math.max(1, Math.round(lines / 25)),
  }
}

const isForMe = (item: InboxItem) => item.kind === 'reply' || item.kind === 'mention'
const threadCount = (items: InboxItem[]) => new Set(items.map((item) => item.discussionId)).size

function classify(mr: QueueMr, me: string, items: InboxItem[], commits: number, now: number) {
  const unread = items.filter((item) => !item.read)
  const forMe = unread.filter(isForMe)
  const comments = unread.filter((item) => item.kind === 'comment')
  const mine = mr.reviewers.find((reviewer) => reviewer.username === me)
  const isAuthor = mr.author.username === me || mr.roles.includes('author')
  const lines = mr.additions + mr.deletions
  const badges: Badge[] = []
  let bucket: Bucket

  if (mr.author.bot) bucket = 'folded'
  else if ((mine && PENDING.has(mine.state)) || forMe.length > 0) {
    bucket = lines <= QUICK_WIN_LINES ? 'quick-wins' : 'needs-you'
  } else if (
    (isAuthor &&
      (mr.reviewers.some((r) => r.state === 'REQUESTED_CHANGES') || comments.length > 0)) ||
    (mine && commits > 0)
  ) {
    bucket = 'returned'
  } else if (
    isAuthor &&
    (mr.approvalsLeft > 0 || mr.reviewers.some((r) => PENDING.has(r.state)))
  ) {
    bucket = 'waiting'
  } else bucket = 'done'

  const needsYou = bucket === 'needs-you' || bucket === 'quick-wins'
  if (forMe.length) badges.push({ kind: 'threads-waiting', count: threadCount(forMe) })
  if (commits > 0) badges.push({ kind: 'commits-since', count: commits })
  if (bucket === 'returned' && mine?.state === 'REQUESTED_CHANGES' && commits > 0) {
    badges.push({ kind: 'changes-addressed' })
  }
  if (bucket === 'waiting') {
    const names = mr.reviewers.filter((r) => PENDING.has(r.state)).map((r) => r.name)
    const days = Math.floor((now - Date.parse(mr.createdAt)) / (24 * HOUR))
    badges.push({ kind: 'waiting-on', names, days: Math.max(0, days) })
  }
  // A failed pipeline matters only where it blocks a merge you own or must approve.
  if (mr.pipeline === 'FAILED' && (isAuthor || needsYou)) badges.push({ kind: 'pipeline-failed' })
  if (isAuthor && mr.needsRebase) badges.push({ kind: 'needs-rebase' })
  if (mr.draft) badges.push({ kind: 'draft' })
  if (mr.labels.some((label) => AGENT_LABEL.test(label))) badges.push({ kind: 'ai-authored' })
  badges.push(sizeBadge(lines))
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
  if (needsReview) tags.push({ kind: 'needs-review' })
  if (forMe.length) tags.push({ kind: 'reply-waiting', count: threadCount(forMe) })
  if (commits > 0) tags.push({ kind: 'new-commits', count: commits })
  if (mine?.state === 'REQUESTED_CHANGES' && commits > 0) tags.push({ kind: 'changes-addressed' })
  if (
    isAuthor &&
    (mr.reviewers.some((r) => r.state === 'REQUESTED_CHANGES') || comments.length > 0)
  ) {
    tags.push({ kind: 'returned' })
  }
  if (isAuthor && (mr.approvalsLeft > 0 || mr.reviewers.some((r) => PENDING.has(r.state)))) {
    const names = mr.reviewers.filter((r) => PENDING.has(r.state)).map((r) => r.name)
    const days = Math.floor((now - Date.parse(mr.createdAt)) / (24 * HOUR))
    tags.push({ kind: 'waiting-on', names, days: Math.max(0, days) })
  }
  if (needsReview && lines <= QUICK_WIN_LINES) tags.push({ kind: 'quick-win', minutes })
  // A failed pipeline matters only where it blocks a merge you own or must review.
  if (mr.pipeline === 'FAILED' && (isAuthor || needsReview)) tags.push({ kind: 'pipeline-failed' })
  if (isAuthor && mr.needsRebase) tags.push({ kind: 'needs-rebase' })
  if (mr.draft) tags.push({ kind: 'draft' })
  if (mr.labels.some((label) => AGENT_LABEL.test(label))) tags.push({ kind: 'ai-authored' })
  return { bucket, badges, blocking, tags, minutes }
}

/** Where an MR with no facts goes, by what its unread inbox items say. */
function orphanBucket(items: InboxItem[]): Bucket {
  if (items.some((item) => isForMe(item) || item.kind === 'review_requested')) return 'needs-you'
  if (items.some((item) => item.kind === 'comment')) return 'returned'
  return 'done'
}

/** What an MR with no facts asks of you, by what its unread inbox items say. */
function orphanTags(items: InboxItem[]): Tag[] {
  const tags: Tag[] = []
  const forMe = items.filter(isForMe)
  if (items.some((item) => item.kind === 'review_requested')) tags.push({ kind: 'needs-review' })
  if (forMe.length) tags.push({ kind: 'reply-waiting', count: threadCount(forMe) })
  if (items.some((item) => item.kind === 'comment')) tags.push({ kind: 'returned' })
  return tags
}

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
      const { bucket, badges, blocking, tags, minutes } = classify(
        mr,
        host.username,
        items,
        commits,
        now,
      )
      const ageHours = (now - Date.parse(mr.createdAt)) / HOUR
      const quickWin = tags.some((tag) => tag.kind === 'quick-win')
      const score = blocking * 10 + ageHours / 6 + (quickWin ? 5 : 0) - (mr.draft ? 20 : 0)
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
        bucket,
        score,
        badges,
        tags,
        attention: attentionOf(tags),
        folded: mr.author.bot,
        minutes,
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
      const forMe = items.filter(isForMe)
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
        bucket: orphanBucket(items),
        score: 0,
        badges: forMe.length ? [{ kind: 'threads-waiting', count: threadCount(forMe) }] : [],
        tags,
        attention: attentionOf(tags),
        folded: false,
        minutes: 0,
        items,
        snoozed: input.snoozed[key] === first.createdAt,
      })
    }
  }
  return rows.sort(
    (a, b) =>
      BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) ||
      b.score - a.score ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )
}

export function bucketCounts(rows: QueueRow[]): Record<Bucket, number> {
  const counts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<Bucket, number>
  for (const row of rows) if (!row.snoozed) counts[row.bucket] += 1
  return counts
}

/** Minutes of review waiting on you today: the size estimates of what needs you. */
export function todaysBudget(rows: QueueRow[]): number {
  return rows
    .filter((row) => !row.snoozed && !row.folded && row.attention === 'needs-you')
    .reduce((sum, row) => sum + row.minutes, 0)
}
