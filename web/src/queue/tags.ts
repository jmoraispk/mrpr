/** What an MR asks of you, or says about itself. A row carries every label that applies. */
export type Tag =
  | { kind: 'blocking'; people: number }
  | { kind: 'waiting-on-you' }
  | { kind: 'changes-addressed' }
  | { kind: 'returned' }
  | { kind: 'quick-win'; minutes: number }
  | { kind: 'waiting-on-others'; days: number }
  | { kind: 'needs-rebase' }

export type TagKind = Tag['kind']

/** How much an MR needs you, from its labels: the default order and the counts use it. */
export type Attention = 'needs-you' | 'returned' | 'waiting' | 'done'

/** The order labels show in when you chose none. */
export const TAG_PRIORITY: TagKind[] = [
  'blocking',
  'changes-addressed',
  'waiting-on-you',
  'returned',
  'quick-win',
  'waiting-on-others',
  'needs-rebase',
]

/** A label's name on its chip, without the row's numbers. */
export const TAG_NAMES: Record<TagKind, string> = {
  blocking: 'Blocking',
  'changes-addressed': 'Changes addressed',
  'waiting-on-you': 'Waiting on you',
  returned: 'Returned to you',
  'quick-win': 'Quick win',
  'waiting-on-others': 'Waiting on others',
  'needs-rebase': 'Needs rebase',
}

/** A label in words, as a row shows it. */
export function tagText(tag: Tag): string {
  switch (tag.kind) {
    case 'blocking':
      return `Blocking ${tag.people} ${tag.people === 1 ? 'person' : 'people'}`
    case 'waiting-on-you':
      return 'Waiting on you'
    case 'changes-addressed':
      return 'Changes addressed'
    case 'returned':
      return 'Returned to you'
    case 'quick-win':
      return `Quick win · ~${tag.minutes} min`
    case 'waiting-on-others':
      return `Waiting on others${tag.days ? ` · ${tag.days}d` : ''}`
    case 'needs-rebase':
      return 'Needs rebase'
  }
}

/**
 * Labels in display order: the ones you chose first, in your order, then the
 * default priority. Waiting on you is left out beside Blocking, which says it already.
 */
export function orderTags(tags: Tag[], order: TagKind[]): Tag[] {
  const blocking = tags.some((tag) => tag.kind === 'blocking')
  const listed = blocking ? tags.filter((tag) => tag.kind !== 'waiting-on-you') : tags
  const rank = (kind: TagKind) => {
    const chosen = order.indexOf(kind)
    return chosen >= 0 ? chosen : order.length + TAG_PRIORITY.indexOf(kind)
  }
  return [...listed].sort((a, b) => rank(a.kind) - rank(b.kind))
}

/** The first `max` labels in display order, and how many more there are. */
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
  if (has('blocking', 'waiting-on-you')) return 'needs-you'
  if (has('returned', 'changes-addressed')) return 'returned'
  if (has('waiting-on-others')) return 'waiting'
  return 'done'
}
