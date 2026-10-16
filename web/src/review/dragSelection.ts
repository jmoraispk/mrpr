import type { DiffSide } from './selection'

export interface DragLineTarget {
  lineNumber: number
  side: DiffSide
}

export interface DragStart {
  target: DragLineTarget
  origin: 'gutter' | 'comment-button' | 'code'
}

const SELECTED_CLASS = 'mrpr-drag-selected'
const CONTEXT_CLASS = 'mrpr-context-preview'

/** Lines GitLab shows above an inline comment when it renders a thread. */
export const CONTEXT_PREVIEW_LINES = 16

const MARKER_SELECTOR =
  '[data-line-old-num], [data-line-new-num], [data-line-num]'
const GUTTER_SELECTOR =
  '.diff-line-num, .diff-line-old-num, .diff-line-new-num'

export function dragStartFromElement(
  element: Element | null,
): DragStart | null {
  const commentWidget = element?.closest<HTMLElement>(
    '[data-add-widget="old"], [data-add-widget="new"]',
  )
  if (commentWidget?.querySelector('button')?.contains(element)) {
    const side = commentWidget.dataset.addWidget as DiffSide
    const marker = commentWidget
      .closest('.diff-line')
      ?.querySelector<HTMLElement>(
        side === 'old'
          ? '[data-line-old-num], [data-line-num]'
          : '[data-line-new-num], [data-line-num]',
      )
    const lineNumber = Number(
      marker?.dataset.lineOldNum ??
        marker?.dataset.lineNewNum ??
        marker?.dataset.lineNum,
    )
    return Number.isInteger(lineNumber) && lineNumber > 0
      ? {
          target: { lineNumber, side },
          origin: 'comment-button',
        }
      : null
  }

  const target = dragTargetFromElement(element)
  if (!target) return null
  const origin = element?.closest(GUTTER_SELECTOR) ? 'gutter' : 'code'
  return { target, origin }
}

export function dragTargetFromElement(
  element: Element | null,
): DragLineTarget | null {
  if (
    !element ||
    element.closest('button, a, input, textarea, select')
  ) {
    return null
  }
  const gutter = element.closest<HTMLElement>(GUTTER_SELECTOR)
  // Code cells carry no line markers, so fall back to the row that holds them.
  const row = element.closest<HTMLElement>('.diff-line')
  const marker =
    element.closest<HTMLElement>(MARKER_SELECTOR) ??
    gutter?.querySelector<HTMLElement>(MARKER_SELECTOR) ??
    row?.querySelector<HTMLElement>(MARKER_SELECTOR)
  if (!marker || !(gutter || row)) {
    return null
  }

  const oldLine = marker.dataset.lineOldNum
  const newLine = marker.dataset.lineNewNum
  const splitLine = marker.dataset.lineNum
  const splitSide = marker.closest<HTMLElement>('.diff-line[data-side]')
    ?.dataset.side
  const side: DiffSide | null =
    splitLine == null
      ? newLine == null
        ? 'old'
        : 'new'
      : splitSide === 'old' || splitSide === 'new'
        ? splitSide
        : null
  const lineNumber = Number(newLine ?? oldLine ?? splitLine)
  if (!side) return null
  return Number.isInteger(lineNumber) && lineNumber > 0
    ? { lineNumber, side }
    : null
}

function markRange(
  root: HTMLElement,
  side: DragLineTarget['side'],
  minimum: number,
  maximum: number,
  className: string,
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
    if (lineNumber < minimum || lineNumber > maximum) continue
    marker.closest('.diff-line')?.classList.add(className)
  }
}

export function clearDragHighlight(root: HTMLElement): void {
  for (const row of root.querySelectorAll(`.${SELECTED_CLASS}`)) {
    row.classList.remove(SELECTED_CLASS)
  }
}

export function highlightDragRange(
  root: HTMLElement,
  start: DragLineTarget,
  end: DragLineTarget,
): void {
  clearDragHighlight(root)
  if (start.side !== end.side) return

  markRange(
    root,
    start.side,
    Math.min(start.lineNumber, end.lineNumber),
    Math.max(start.lineNumber, end.lineNumber),
    SELECTED_CLASS,
  )
}

export function clearContextPreview(root: HTMLElement): void {
  for (const row of root.querySelectorAll(`.${CONTEXT_CLASS}`)) {
    row.classList.remove(CONTEXT_CLASS)
  }
}

/**
 * Shade the lines GitLab will show above a comment, so a single-line
 * selection reveals the whole excerpt the posted thread will carry.
 */
export function highlightContextPreview(
  root: HTMLElement,
  anchor: DragLineTarget,
  size: number = CONTEXT_PREVIEW_LINES,
): void {
  clearContextPreview(root)
  const first = Math.max(1, anchor.lineNumber - size + 1)
  markRange(root, anchor.side, first, anchor.lineNumber, CONTEXT_CLASS)
}

export function findCommentButton(
  root: HTMLElement,
  target: DragLineTarget,
): HTMLButtonElement | null {
  const unifiedAttribute =
    target.side === 'old' ? 'data-line-old-num' : 'data-line-new-num'
  const marker =
    root.querySelector<HTMLElement>(
      `[${unifiedAttribute}="${target.lineNumber}"]`,
    ) ??
    root.querySelector<HTMLElement>(
      `.diff-line[data-side="${target.side}"] [data-line-num="${target.lineNumber}"]`,
    )
  return (
    marker
      ?.closest('.diff-line')
      ?.querySelector<HTMLButtonElement>(
        `[data-add-widget="${target.side}"] button`,
      ) ?? null
  )
}
