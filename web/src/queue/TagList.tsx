import { tagText, visibleTags, type Tag, type TagKind } from './tags'

const NO_ORDER: TagKind[] = []

/** Tags in words: your chosen tags first, then by priority; past `max`, a "+N". */
export function TagList({
  tags,
  order = NO_ORDER,
  max = Infinity,
}: {
  tags: Tag[]
  order?: TagKind[]
  max?: number
}) {
  const { shown, more } = visibleTags(tags, order, max)
  if (!shown.length) return null
  return (
    <span className="q-tags">
      {shown.map((tag) => (
        <span key={tag.kind} className={`q-tag is-${tag.kind}`}>
          {tagText(tag)}
        </span>
      ))}
      {more > 0 ? <span className="q-tag is-more">+{more}</span> : null}
    </span>
  )
}
