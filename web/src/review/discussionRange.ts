import type {
  DiffFile,
  Discussion,
  LineRangeEndpoint,
} from '../api/types'
import type { DiffSide } from './selection'

export interface DiscussionRange {
  side: 'old' | 'new'
  startLine: number
  endLine: number
  anchorLine: number
  label: string
}

const DISCUSSION_RANGE_CLASS = 'mrpr-discussion-range'

function discussionPosition(discussion: Discussion) {
  return discussion.notes.find((note) => note.position)?.position ?? null
}

function belongsToFile(
  position: NonNullable<ReturnType<typeof discussionPosition>>,
  file: Pick<DiffFile, 'old_path' | 'new_path'>,
): boolean {
  return (
    position.new_path === file.new_path ||
    position.old_path === file.old_path
  )
}

function lineForSide(
  side: DiffSide,
  endpoint: LineRangeEndpoint,
): number | null {
  if (endpoint.type !== side && endpoint.type !== null) {
    return null
  }
  const line = side === 'new' ? endpoint.new_line : endpoint.old_line
  return typeof line === 'number' && Number.isSafeInteger(line) && line > 0
    ? line
    : null
}

function formatRangeLabel(
  side: DiffSide,
  startLine: number,
  endLine: number,
): string {
  const prefix = side === 'new' ? '+' : '-'
  return `Lines ${prefix}${startLine}–${prefix}${endLine}`
}

export function discussionRange(
  discussion: Discussion,
  file: Pick<DiffFile, 'old_path' | 'new_path'>,
): DiscussionRange | null {
  const position = discussionPosition(discussion)
  if (!position || !belongsToFile(position, file)) {
    return null
  }

  const side: DiffSide = position.new_line != null ? 'new' : 'old'
  const topLevelLine =
    side === 'new' ? position.new_line : position.old_line
  if (
    typeof topLevelLine !== 'number' ||
    !Number.isSafeInteger(topLevelLine) ||
    topLevelLine <= 0
  ) {
    return null
  }

  const lineRange = position.line_range
  let startLine = topLevelLine
  let endLine = topLevelLine
  let anchorLine = topLevelLine

  if (lineRange?.start && lineRange?.end) {
    const startCoord = lineForSide(side, lineRange.start)
    const endCoord = lineForSide(side, lineRange.end)
    if (startCoord != null && endCoord != null) {
      startLine = Math.min(startCoord, endCoord)
      endLine = Math.max(startCoord, endCoord)
      anchorLine = endCoord
    }
  }

  return {
    side,
    startLine,
    endLine,
    anchorLine,
    label: formatRangeLabel(side, startLine, endLine),
  }
}

function highlightSideRange(
  root: HTMLElement,
  side: DiffSide,
  startLine: number,
  endLine: number,
): void {
  const unifiedAttribute =
    side === 'old' ? 'data-line-old-num' : 'data-line-new-num'
  const markers = [
    ...root.querySelectorAll<HTMLElement>(`[${unifiedAttribute}]`),
    ...root.querySelectorAll<HTMLElement>(
      `.diff-line[data-side="${side}"] [data-line-num]`,
    ),
  ]

  for (const marker of markers) {
    const lineNumber = Number(
      marker.getAttribute(unifiedAttribute) ??
        marker.getAttribute('data-line-num'),
    )
    if (lineNumber < startLine || lineNumber > endLine) continue
    marker.closest('.diff-line')?.classList.add(DISCUSSION_RANGE_CLASS)
  }
}

export function highlightDiscussionRanges(
  root: HTMLElement,
  ranges: DiscussionRange[],
): () => void {
  for (const range of ranges) {
    highlightSideRange(root, range.side, range.startLine, range.endLine)
  }

  return () => {
    for (const row of root.querySelectorAll(`.${DISCUSSION_RANGE_CLASS}`)) {
      row.classList.remove(DISCUSSION_RANGE_CLASS)
    }
  }
}
