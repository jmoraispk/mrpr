import {
  DiffModeEnum,
  DiffView,
  SplitSide,
  DiffFile as ParsedDiffFile,
} from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view-pure.css'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { DiffFile, Discussion, PostingResult } from '../api/types'
import { CommentComposer } from './CommentComposer'
import { toDiffData } from './diffAdapter'
import { diffStats, diffStatsLabel } from './diffStats'
import {
  clearContextPreview,
  clearDragHighlight,
  dragStartFromElement,
  dragTargetFromElement,
  findCommentButton,
  highlightContextPreview,
  highlightDragRange,
  type DragLineTarget,
} from './dragSelection'
import {
  bundleCacheKey,
  cachedBundle,
  requestBundle,
  workersAvailable,
  type DiffMode,
  type DiffTheme,
} from './diffWorkerClient'
import { DiscussionThread } from './DiscussionThread'
import {
  discussionRange,
  highlightDiscussionRanges,
  type DiscussionRange,
} from './discussionRange'
import {
  extendSelection,
  toBackendSelection,
  type DiffSide,
  type LinePoint,
  type SelectionRange,
} from './selection'


interface DiffViewerRef {
  getDiffFileInstance: () => ParsedDiffFile | null
}

interface ActiveDrag {
  pointerId: number
  start: DragLineTarget
  current: DragLineTarget
  moved: boolean
  openOnRelease: boolean
  /**
   * Drags that begin over code stay dormant until they cross a line, so a
   * short horizontal drag still selects text for copying.
   */
  fromCode: boolean
}

export interface DiffFileSectionProps {
  file: DiffFile
  discussions?: Discussion[]
  mode: DiffMode
  theme: DiffTheme
  showComments: boolean
  /** Height the stream reserved, held while the diff is still building. */
  reservedHeight?: number
  onInlineCountChange?: (count: number) => void
  onRequestShowComments?: () => void
  onSelectionChange?: (selection: SelectionRange | null) => void
  /** Show threads but start no new inline comments, e.g. a diff not of the MR's own versions. */
  readOnly?: boolean
}

interface PositionedDiscussion {
  discussion: Discussion
  range: DiscussionRange
}
interface DiscussionExtensionData {
  oldFile: Record<string, { data: PositionedDiscussion[] }>
  newFile: Record<string, { data: PositionedDiscussion[] }>
}

function groupDiscussions(file: DiffFile, discussions: Discussion[]) {
  const oldFile: Record<string, { data: PositionedDiscussion[] }> = {}
  const newFile: Record<string, { data: PositionedDiscussion[] }> = {}
  const ranges: DiscussionRange[] = []
  let inlineCount = 0

  for (const discussion of discussions) {
    const range = discussionRange(discussion, file)
    if (!range) continue
    const side = range.side === 'new' ? newFile : oldFile
    const key = String(range.anchorLine)
    side[key] = {
      data: [...(side[key]?.data ?? []), { discussion, range }],
    }
    ranges.push(range)
    inlineCount += 1
  }

  return { extendData: { oldFile, newFile }, inlineCount, ranges }
}

function WidgetCloseCapture({
  onClose,
  onReady,
}: {
  onClose: () => void
  onReady: (close: (() => void) | null) => void
}) {
  useEffect(() => {
    onReady(onClose)
    return () => onReady(null)
  }, [onClose, onReady])
  return null
}

type DiffData = ReturnType<typeof toDiffData>

const EMPTY_EXTEND_DATA: DiscussionExtensionData = {
  oldFile: {},
  newFile: {},
}

function processDiff(
  data: DiffData,
  theme: DiffTheme,
  mode: DiffMode,
): ParsedDiffFile {
  const diffFile = ParsedDiffFile.createInstance(data)
  diffFile.initTheme(theme)
  diffFile.initRaw()
  if (mode === 'split') diffFile.buildSplitDiffLines()
  else diffFile.buildUnifiedDiffLines()
  return diffFile
}

export function DiffFileSection({
  file,
  discussions = [],
  mode,
  theme,
  showComments,
  reservedHeight,
  onInlineCountChange,
  onRequestShowComments,
  onSelectionChange,
  readOnly = false,
}: DiffFileSectionProps) {
  const [highlight, setHighlight] = useState(false)
  const [selection, setSelection] = useState<SelectionRange | null>(null)
  const [fallbackNotice, setFallbackNotice] =
    useState<PostingResult['fallback'] | null>(null)
  const [processedDiff, setProcessedDiff] =
    useState<ParsedDiffFile | null>(null)
  const shiftPressed = useRef(false)
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const pendingDragSelectionRef = useRef<SelectionRange | null>(null)
  const diffViewRef = useRef<DiffViewerRef>(null)
  const diffLibraryRef = useRef<HTMLDivElement>(null)
  const widgetCloseRef = useRef<(() => void) | null>(null)
  const registerWidgetClose = useCallback(
    (close: (() => void) | null) => {
      widgetCloseRef.current = close
    },
    [],
  )
  const { extendData, inlineCount, ranges } = useMemo(
    () => groupDiscussions(file, discussions),
    [discussions, file],
  )
  const diffData = useMemo(
    () => toDiffData(file),
    [file],
  )
  const fileChanges = useMemo(() => diffStats(file.diff), [file.diff])

  useEffect(() => {
    let active = true
    const key = bundleCacheKey(file.new_path || file.old_path, theme, mode)
    const hit = cachedBundle(key)
    if (hit !== undefined) {
      setProcessedDiff(ParsedDiffFile.createInstance(diffData, hit))
      return
    }

    if (!workersAvailable()) {
      setProcessedDiff(processDiff(diffData, theme, mode))
      return
    }

    setProcessedDiff(null)
    requestBundle(key, diffData, theme, mode)
      .then((bundle) => {
        if (!active) return
        setProcessedDiff(ParsedDiffFile.createInstance(diffData, bundle))
      })
      .catch(() => {
        if (!active) return
        setProcessedDiff(processDiff(diffData, theme, mode))
      })

    return () => {
      active = false
    }
  }, [diffData, file, mode, theme])

  useEffect(() => {
    setSelection(null)
    activeDragRef.current = null
    pendingDragSelectionRef.current = null
    if (diffLibraryRef.current) {
      clearDragHighlight(diffLibraryRef.current)
    }
  }, [file.old_path, file.new_path])

  useEffect(() => {
    setHighlight(false)
    if (!processedDiff) return
    const enableHighlight = () => setHighlight(true)
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(enableHighlight)
      return () => window.cancelIdleCallback(idleId)
    }
    const timeoutId = window.setTimeout(enableHighlight, 0)
    return () => window.clearTimeout(timeoutId)
  }, [processedDiff])

  useEffect(() => {
    onSelectionChange?.(selection)
  }, [onSelectionChange, selection])

  // Show the excerpt GitLab will render above a single-line comment.
  useEffect(() => {
    const root = diffLibraryRef.current
    if (!root) return
    clearContextPreview(root)
    if (!selection) return

    const side = selection.end.side
    const lineOf = (point: SelectionRange['end']) =>
      side === 'new'
        ? (point.newLine ?? point.oldLine)
        : (point.oldLine ?? point.newLine)
    const anchor = lineOf(selection.end)
    if (anchor === null || lineOf(selection.start) !== anchor) return

    highlightContextPreview(root, { lineNumber: anchor, side })
    return () => clearContextPreview(root)
  }, [mode, processedDiff, selection])

  useEffect(() => {
    const root = diffLibraryRef.current
    if (!showComments || !root) return

    return highlightDiscussionRanges(
      root,
      ranges.filter((range) => range.startLine !== range.endLine),
    )
  }, [mode, processedDiff, ranges, showComments])

  useEffect(() => {
    const root = diffLibraryRef.current
    if (!root) return

    const labelCommentButtons = () => {
      for (const button of root.querySelectorAll<HTMLButtonElement>(
        '.diff-add-widget',
      )) {
        const holder = button.closest<HTMLElement>(
          '[data-add-widget]',
        )
        const side = holder?.dataset.addWidget
        const line = button
          .closest('[data-state="diff"]')
          ?.querySelector<HTMLElement>(
            `[data-line-${side === 'old' ? 'old' : 'new'}-num]`,
          )
          ?.textContent?.trim()
        button.type = 'button'
        button.setAttribute(
          'aria-label',
          `Comment on ${side ?? 'diff'} line ${line ?? 'unknown'}`,
        )
      }
    }

    labelCommentButtons()
    const observer = new MutationObserver(labelCommentButtons)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [mode, processedDiff])

  useEffect(() => {
    onInlineCountChange?.(inlineCount)
  }, [inlineCount, onInlineCountChange])

  function pointForLine(lineNumber: number, side: SplitSide): LinePoint {
    const parsed = diffViewRef.current?.getDiffFileInstance()
    const line =
      mode === 'unified'
        ? parsed?.getUnifiedLineByLineNumber(lineNumber, side)
        : parsed?.getSplitLineByLineNumber(lineNumber, side)
    const diff = line?.diff
    const selectedSide: DiffSide =
      side === SplitSide.old ? 'old' : 'new'
    return {
      oldLine:
        diff?.oldLineNumber ??
        (selectedSide === 'old' ? lineNumber : null),
      newLine:
        diff?.newLineNumber ??
        (selectedSide === 'new' ? lineNumber : null),
      side: selectedSide,
    }
  }

  function selectLine(lineNumber: number, side: SplitSide) {
    setFallbackNotice(null)
    const draggedSelection = pendingDragSelectionRef.current
    if (draggedSelection) {
      pendingDragSelectionRef.current = null
      setSelection(draggedSelection)
      return
    }
    const point = pointForLine(lineNumber, side)
    const shouldExtend = shiftPressed.current
    setSelection((current) =>
      extendSelection(shouldExtend ? current : null, point),
    )
    shiftPressed.current = false
  }

  function selectionForWidget(
    lineNumber: number,
    side: SplitSide,
  ): SelectionRange {
    return (
      selection ??
      pendingDragSelectionRef.current ??
      extendSelection(null, pointForLine(lineNumber, side))
    )
  }

  function rememberModifier(event: MouseEvent<HTMLDivElement>) {
    shiftPressed.current = event.shiftKey
  }

  function handleMouseDownCapture(event: MouseEvent<HTMLDivElement>) {
    if (activeDragRef.current?.openOnRelease) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    rememberModifier(event)
  }

  function closeComposer() {
    setSelection(null)
    activeDragRef.current = null
    pendingDragSelectionRef.current = null
    if (diffLibraryRef.current) {
      clearDragHighlight(diffLibraryRef.current)
      clearContextPreview(diffLibraryRef.current)
    }
    widgetCloseRef.current?.()
    widgetCloseRef.current = null
  }

  function splitSide(target: DragLineTarget): SplitSide {
    return target.side === 'old' ? SplitSide.old : SplitSide.new
  }

  function rangeForDrag(
    start: DragLineTarget,
    end: DragLineTarget,
  ): SelectionRange {
    const initial = extendSelection(
      null,
      pointForLine(start.lineNumber, splitSide(start)),
    )
    return extendSelection(
      initial,
      pointForLine(end.lineNumber, splitSide(end)),
    )
  }

  function pointerTarget(
    event: ReactPointerEvent<HTMLDivElement>,
  ): DragLineTarget | null {
    const element = document.elementFromPoint(
      event.clientX,
      event.clientY,
    )
    return dragTargetFromElement(element ?? (event.target as Element))
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const start = dragStartFromElement(event.target as Element)
    if (!start) return

    setFallbackNotice(null)
    closeComposer()
    const fromCode = start.origin === 'code'
    activeDragRef.current = {
      pointerId: event.pointerId,
      start: start.target,
      current: start.target,
      moved: false,
      openOnRelease: start.origin === 'comment-button',
      fromCode,
    }
    if (fromCode) return

    highlightDragRange(event.currentTarget, start.target, start.target)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  function continueDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = activeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const target = pointerTarget(event)
    if (!target || target.side !== drag.start.side) return
    const crossedLine = target.lineNumber !== drag.start.lineNumber
    // A drag that began over code only claims the pointer once it leaves the
    // line it started on; until then the browser keeps selecting text.
    if (drag.fromCode && !drag.moved && !crossedLine) return
    if (drag.fromCode && !drag.moved) {
      document.getSelection()?.removeAllRanges()
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }

    drag.current = target
    drag.moved ||= crossedLine
    highlightDragRange(event.currentTarget, drag.start, target)
    event.preventDefault()
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = activeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    activeDragRef.current = null
    // A code drag that never crossed a line was a text selection, not ours.
    if (drag.fromCode && !drag.moved) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    event.preventDefault()

    if (!drag.moved && !drag.openOnRelease) {
      clearDragHighlight(event.currentTarget)
      return
    }

    const range = rangeForDrag(drag.start, drag.current)
    const endpoint: DragLineTarget = {
      lineNumber: drag.moved
        ? Math.max(drag.start.lineNumber, drag.current.lineNumber)
        : drag.start.lineNumber,
      side: drag.start.side,
    }
    pendingDragSelectionRef.current = range
    setSelection(range)

    requestAnimationFrame(() => {
      const root = diffLibraryRef.current
      const button = root && findCommentButton(root, endpoint)
      if (button) {
        button.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
          }),
        )
        return
      }
      pendingDragSelectionRef.current = null
      setSelection(null)
      if (root) clearDragHighlight(root)
    })
  }

  function cancelDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = activeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    activeDragRef.current = null
    clearDragHighlight(event.currentTarget)
  }

  function handlePostedComment(result: PostingResult) {
    if (result.fallback !== 'none') {
      setFallbackNotice(result.fallback)
    }
    closeComposer()
    if (result.placement !== 'inline') return
    onRequestShowComments?.()
    requestAnimationFrame(() => {
      const thread = Array.from(
        document.querySelectorAll<HTMLElement>('[data-discussion-id]'),
      ).find(
        (element) =>
          element.dataset.discussionId === result.discussion.id,
      )
      thread?.focus()
    })
  }

  if (file.too_large || file.collapsed) {
    return (
      <section className="diff-stage unavailable-diff" data-diff-ready="true">
        <header className="diff-header">
          <strong title={file.new_path}>{file.new_path}</strong>
        </header>
        <div className="diff-explanation">
          <span aria-hidden="true">↯</span>
          <h2>Diff unavailable</h2>
          <p>
            {file.too_large
              ? 'This file is too large for GitLab to return through the diff API.'
              : 'This file was collapsed by GitLab. Open it in GitLab to inspect the full content.'}
          </p>
        </div>
      </section>
    )
  }

  if (!processedDiff) {
    return (
      <section
        className="diff-stage diff-loading"
        aria-label={file.new_path}
        // Hold the space the stream reserved for this file. Collapsing to the
        // height of this message would yank everything below it upward for a
        // frame, which is what tears the view when scrolling up into a file
        // whose diff is still being built.
        style={reservedHeight ? { minHeight: reservedHeight } : undefined}
      >
        Preparing diff…
      </section>
    )
  }

  return (
      <section className="diff-stage" aria-label={file.new_path} data-diff-ready="true">
      <header className="diff-header">
        <div className="diff-file-identity">
          <span className="language-dot" aria-hidden="true" />
          <h2 className="diff-file-name" title={file.new_path}>
            {file.new_path}
          </h2>
          <span
            className="file-header-stats"
            aria-label={`File changes: ${diffStatsLabel(fileChanges)}`}
          >
            <span className="stat-addition" aria-hidden="true">
              +{fileChanges.additions}
            </span>
            <span className="stat-deletion" aria-hidden="true">
              −{fileChanges.deletions}
            </span>
          </span>
        </div>
      </header>
      {fallbackNotice ? (
        <div className="fallback-notice" role="status">
          <span>
            {fallbackNotice === 'final_line'
              ? 'GitLab stored this range comment on its final line.'
              : 'GitLab stored this as a general discussion.'}
          </span>
          <button
            aria-label="Dismiss status"
            type="button"
            onClick={() => setFallbackNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div
        className="diff-library"
        ref={diffLibraryRef}
        onClickCapture={rememberModifier}
        onMouseDownCapture={handleMouseDownCapture}
        onPointerDownCapture={beginDrag}
        onPointerMoveCapture={continueDrag}
        onPointerUpCapture={endDrag}
        onPointerCancelCapture={cancelDrag}
      >
        <DiffView
          key={`${file.old_path}:${file.new_path}:${mode}:${theme}`}
          ref={diffViewRef}
          diffFile={processedDiff}
          diffViewMode={
            mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified
          }
          diffViewTheme={theme}
          diffViewHighlight={highlight}
          diffViewAddWidget={!readOnly}
          diffViewFontSize={12}
          extendData={
            !showComments
              ? EMPTY_EXTEND_DATA
              : readOnly
                // Old-side anchors are numbered against the MR's base, not this diff's.
                ? { oldFile: {}, newFile: extendData.newFile }
                : extendData
          }
          onAddWidgetClick={selectLine}
          renderWidgetLine={({ lineNumber, side, onClose }) => (
            <div className="inline-comment-widget">
              <WidgetCloseCapture
                onClose={onClose}
                onReady={registerWidgetClose}
              />
              <CommentComposer
                selection={toBackendSelection(
                  file,
                  selectionForWidget(lineNumber, side),
                )}
                onCancel={closeComposer}
                onPosted={handlePostedComment}
              />
            </div>
          )}
          renderExtendLine={({ data = [] }) => (
            <div className="line-discussions">
              {data.map(({ discussion, range }) => (
                <DiscussionThread
                  discussion={discussion}
                  key={discussion.id}
                  rangeLabel={
                    range.startLine !== range.endLine
                      ? range.label
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        />
      </div>
      </section>
  )
}
