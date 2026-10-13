import type { TagChip } from '../order'
import { TAG_NAMES, type TagKind } from '../tags'

/** One chip per tag: a click puts that tag first, after any already chosen. */
export function TagBar({
  chips,
  onToggle,
  onClear,
}: {
  chips: TagChip[]
  onToggle: (kind: TagKind) => void
  onClear: () => void
}) {
  if (!chips.length) return null
  return (
    <div className="sb-chips" role="group" aria-label="Put tags first">
      {chips.map((chip) => (
        <button
          key={chip.kind}
          type="button"
          className="sb-chip"
          aria-pressed={chip.position !== null}
          onClick={() => onToggle(chip.kind)}
        >
          {chip.position !== null ? <span className="sb-chip-pos">{chip.position}</span> : null}
          {TAG_NAMES[chip.kind]} <span className="sb-chip-count">{chip.count}</span>
        </button>
      ))}
      {chips.some((chip) => chip.position !== null) ? (
        <button type="button" className="sb-clear" onClick={onClear}>
          Clear
        </button>
      ) : null}
    </div>
  )
}
