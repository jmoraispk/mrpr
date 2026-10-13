/** What an MR asks of you, or says about itself. A row carries every tag that applies. */
export type Tag =
  | { kind: 'blocking'; people: number }
  | { kind: 'needs-review' }
  | { kind: 'reply-waiting'; count: number }
  | { kind: 'new-commits'; count: number }
  | { kind: 'changes-addressed' }
  | { kind: 'returned' }
  | { kind: 'waiting-on'; names: string[]; days: number }
  | { kind: 'quick-win'; minutes: number }
  | { kind: 'pipeline-failed' }
  | { kind: 'needs-rebase' }
  | { kind: 'draft' }
  | { kind: 'ai-authored' }

export type TagKind = Tag['kind']

/** How much an MR needs you, from its tags: the default order and the counts use it. */
export type Attention = 'needs-you' | 'returned' | 'waiting' | 'done'

/** The order tags show in when you chose none. */
export const TAG_PRIORITY: TagKind[] = [
  'blocking',
  'new-commits',
  'changes-addressed',
  'reply-waiting',
  'needs-review',
  'returned',
  'quick-win',
  'waiting-on',
  'pipeline-failed',
  'needs-rebase',
  'draft',
  'ai-authored',
]

/** A tag's name on its chip, without the row's numbers. */
export const TAG_NAMES: Record<TagKind, string> = {
  blocking: 'Blocking',
  'new-commits': 'New commits',
  'changes-addressed': 'Changes addressed',
  'reply-waiting': 'Reply waiting',
  'needs-review': 'Needs your review',
  returned: 'Returned to you',
  'quick-win': 'Quick win',
  'waiting-on': 'Waiting on others',
  'pipeline-failed': 'Pipeline failed',
  'needs-rebase': 'Needs rebase',
  draft: 'Draft',
  'ai-authored': 'AI-authored',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A tag in words, as a row shows it. */
export function tagText(tag: Tag): string {
  switch (tag.kind) {
    case 'blocking':
      return `Blocking ${plural(tag.people, 'person', 'people')}`
    case 'needs-review':
      return 'Needs your review'
    case 'reply-waiting':
      return tag.count === 1 ? 'Reply waiting' : `${tag.count} replies waiting`
    case 'new-commits':
      return plural(tag.count, 'new commit', 'new commits')
    case 'changes-addressed':
      return 'Changes addressed'
    case 'returned':
      return 'Returned to you'
    case 'waiting-on': {
      const who = tag.names.join(', ') || 'approvals'
      return `Waiting on ${who}${tag.days ? ` · ${tag.days}d` : ''}`
    }
    case 'quick-win':
      return `Quick win · ~${tag.minutes} min`
    case 'pipeline-failed':
      return 'Pipeline failed'
    case 'needs-rebase':
      return 'Needs rebase'
    case 'draft':
      return 'Draft'
    case 'ai-authored':
      return 'AI-authored'
  }
}

/**
 * Tags in display order: the ones you chose first, in your order, then the default
 * priority. Needs your review is left out beside Blocking, which says it already.
 */
export function orderTags(tags: Tag[], order: TagKind[]): Tag[] {
  const blocking = tags.some((tag) => tag.kind === 'blocking')
  const listed = blocking ? tags.filter((tag) => tag.kind !== 'needs-review') : tags
  const rank = (kind: TagKind) => {
    const chosen = order.indexOf(kind)
    return chosen >= 0 ? chosen : order.length + TAG_PRIORITY.indexOf(kind)
  }
  return [...listed].sort((a, b) => rank(a.kind) - rank(b.kind))
}

/** The first `max` tags in display order, and how many more there are. */
export function visibleTags(
  tags: Tag[],
  order: TagKind[],
  max: number,
): { shown: Tag[]; more: number } {
  const all = orderTags(tags, order)
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) }
}

export function attentionOf(tags: Tag[]): Attention {
  const has = (...kinds: TagKind[]) => tags.some((tag) => kinds.includes(tag.kind))
  if (has('blocking', 'needs-review', 'reply-waiting')) return 'needs-you'
  if (has('returned', 'changes-addressed', 'new-commits')) return 'returned'
  if (has('waiting-on')) return 'waiting'
  return 'done'
}
