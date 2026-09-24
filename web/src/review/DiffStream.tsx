import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'

import type { DiffFile, Discussion } from '../api/types'
import { DiffFileSection } from './DiffFileSection'
import { toDiffData } from './diffAdapter'
import { estimateSectionHeight } from './diffMetrics'
import { preferredTheme, watchTheme } from './diffTheme'
import {
  bundleCacheKey,
  cachedBundle,
  requestBundle,
  type DiffMode,
} from './diffWorkerClient'

/** Files on each side of the window whose diffs are built ahead of time. */
const PREFETCH_SECTIONS = 4

/** Room left above a thread the stream scrolls to, so its code shows too. */
const THREAD_MARGIN_PX = 96

/**
 * An explicit request to scroll to a file. The nonce distinguishes two
 * requests for the same file, and using a request rather than reacting to the
 * active index keeps the stream from scrolling to a file it reported itself.
 */
export interface ScrollRequest {
  index: number
  nonce: number
  /** Land on this thread inside the file rather than on the file's header. */
  discussionId?: string
}

export interface DiffStreamProps {
  files: DiffFile[]
  discussions?: Discussion[]
  activeIndex: number
  /** Owned by the app so the review controls can sit in the header. */
  mode: DiffMode
  showComments: boolean
  scrollRequest?: ScrollRequest | null
  onActiveIndexChange: (index: number) => void
  onInlineCountChange?: (count: number) => void
  onRequestShowComments?: () => void
  scrollRef: RefObject<HTMLElement | null>
}

export function DiffStream({
  files,
  discussions = [],
  activeIndex,
  mode,
  showComments,
  scrollRequest = null,
  onActiveIndexChange,
  onInlineCountChange,
  onRequestShowComments,
  scrollRef,
}: DiffStreamProps) {
  const [theme, setTheme] = useState(preferredTheme)
  const [inlineCounts, setInlineCounts] = useState<Record<number, number>>({})

  useEffect(() => watchTheme(setTheme), [])

  const estimates = useMemo(
    () => files.map((file) => estimateSectionHeight(file, mode)),
    [files, mode],
  )
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimates[index] ?? 200,
    overscan: 2,
    initialRect: { width: 900, height: 800 },
  })

  const inlineCount = useMemo(
    () => Object.values(inlineCounts).reduce((total, count) => total + count, 0),
    [inlineCounts],
  )

  useEffect(() => {
    onInlineCountChange?.(inlineCount)
  }, [inlineCount, onInlineCountChange])

  const items = virtualizer.getVirtualItems()
  // Before the scroll container has a measured height the virtualizer yields
  // nothing. Render a small window in normal flow so the first paint, and any
  // environment without layout, still shows the file being read.
  const unmeasured = items.length === 0 && files.length > 0
  const fallbackWindow = useMemo(() => {
    if (!unmeasured) return []
    const first = Math.min(Math.max(0, activeIndex), files.length - 1)
    return Array.from({ length: 3 }, (_, offset) => first + offset).filter(
      (index) => index < files.length,
    )
  }, [activeIndex, files.length, unmeasured])

  // While scrolling to a rail selection the stream passes over other files.
  // Reporting those would retarget the scroll mid-flight, so stay quiet until
  // the requested file arrives.
  const scrollTargetRef = useRef<number | null>(null)

  // Declared before the reporting effect on purpose: effects run in
  // declaration order, and reporting first would push the active index back
  // to the top of the viewport before this scroll ever ran.
  useEffect(() => {
    if (!scrollRequest) return
    scrollTargetRef.current = scrollRequest.index
    // Set the offset directly rather than calling scrollToIndex: after a long
    // jump the virtualizer treats a repeat request for the same index as
    // already satisfied, and stops short of the file.
    const scroll = () => {
      const scroller = scrollRef.current
      const offset = virtualizer.getOffsetForIndex(
        scrollRequest.index,
        'start',
      )?.[0]
      if (scroller && offset !== undefined) scroller.scrollTop = offset
      else virtualizer.scrollToIndex(scrollRequest.index, { align: 'start' })
    }
    scroll()

    // Sections measure themselves as they mount, which shifts every offset
    // below them, so the first scroll lands near rather than on the file.
    // Once the section is actually mounted its real position is the truth, so
    // close the remaining gap from the DOM. A few frames, stopping the moment
    // it lands: corrections that linger move content the reader is using.
    // A long jump crosses hundreds of sections whose sizes only firm up as
    // they mount, so converge on a time budget rather than a frame count.
    let frame = 0
    let elapsed = 0
    // A thread target keeps going until its thread exists: the section mounts
    // before its diff is built, and stopping at the header would leave the
    // thread below the fold.
    const BUDGET_MS = scrollRequest.discussionId ? 4_000 : 1_500
    const correct = () => {
      elapsed += 16
      const scroller = scrollRef.current
      const section = scroller?.querySelector<HTMLElement>(
        `[data-stream-index="${scrollRequest.index}"]`,
      )
      if (scroller && section) {
        const thread = scrollRequest.discussionId
          ? Array.from(
              section.querySelectorAll<HTMLElement>('[data-discussion-id]'),
            ).find(
              (element) =>
                element.dataset.discussionId === scrollRequest.discussionId,
            )
          : undefined
        const anchor = thread ?? section
        const gap =
          anchor.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          (thread ? THREAD_MARGIN_PX : 0)
        if (Math.abs(gap) <= 1 && (thread || !scrollRequest.discussionId)) return
        scroller.scrollTop += gap
      } else {
        scroll()
      }
      if (elapsed < BUDGET_MS) frame = requestAnimationFrame(correct)
    }
    frame = requestAnimationFrame(correct)
    // Releasing on a timer keeps a scroll that never lands exactly on the
    // target from silencing the rail for good.
    const release = window.setTimeout(() => {
      scrollTargetRef.current = null
    }, BUDGET_MS + 500)

    // A correction that fires while the reader is aiming at a gutter would
    // pull the line out from under them, so any input cancels the rest.
    const scroller = scrollRef.current
    const abandon = () => {
      cancelAnimationFrame(frame)
      scrollTargetRef.current = null
    }
    const events = ['wheel', 'pointerdown', 'keydown'] as const
    for (const event of events) {
      scroller?.addEventListener(event, abandon, { passive: true })
    }

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(release)
      for (const event of events) {
        scroller?.removeEventListener(event, abandon)
      }
    }
  }, [scrollRef, scrollRequest, virtualizer])

  // The topmost section still on screen is the file being read. Overscanned
  // sections sit above the viewport, so skip anything that ends before it.
  const scrollOffset = virtualizer.scrollOffset ?? 0
  useEffect(() => {
    const first = items.find((item) => item.end > scrollOffset) ?? items[0]
    if (!first) return
    if (scrollTargetRef.current !== null) {
      if (first.index === scrollTargetRef.current) scrollTargetRef.current = null
      return
    }
    if (first.index !== activeIndex) onActiveIndexChange(first.index)
  }, [activeIndex, items, onActiveIndexChange, scrollOffset])

  // Warm the diffs just outside the window while the main thread is idle, so
  // a section that scrolls into view already has its bundle and mounts
  // without a build. Keeps few files rendered while still feeling preloaded.
  const firstIndex = items[0]?.index ?? 0
  const lastIndex = items[items.length - 1]?.index ?? 0
  useEffect(() => {
    if (!files.length) return
    const from = Math.max(0, firstIndex - PREFETCH_SECTIONS)
    const to = Math.min(files.length - 1, lastIndex + PREFETCH_SECTIONS)

    const warm = () => {
      for (let index = from; index <= to; index += 1) {
        const file = files[index]
        if (!file) continue
        const key = bundleCacheKey(file.new_path || file.old_path, theme, mode)
        if (cachedBundle(key) !== undefined) continue
        void requestBundle(key, toDiffData(file), theme, mode).catch(
          () => undefined,
        )
      }
    }

    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 500 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(warm, 50)
    return () => window.clearTimeout(id)
  }, [files, firstIndex, lastIndex, mode, theme])

  // A zero-height measurement means the section is not laid out yet; taking it
  // would collapse the reserved space and wreck the scrollbar. Sub-pixel
  // differences from the estimate are ignored too: applying them re-flows
  // every offset below, which drags a scroll target around while it settles.
  const measureSection = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return
      // A section still building its diff shows a short placeholder. Recording
      // that would tell the virtualizer the file is a fraction of its real
      // size, and every offset past it would be wrong.
      if (!element.querySelector('[data-diff-ready="true"]')) return
      const height = element.getBoundingClientRect().height
      if (height === 0) return
      const index = Number(element.dataset.index)
      const known = virtualizer.measurementsCache[index]?.size
      if (known !== undefined && Math.abs(known - height) < 8) return
      virtualizer.measureElement(element)
    },
    [virtualizer],
  )

  const reportInlineCount = useCallback((index: number, count: number) => {
    setInlineCounts((current) =>
      current[index] === count ? current : { ...current, [index]: count },
    )
  }, [])

  return (
      <div
        className="diff-stream"
        style={
          unmeasured
            ? undefined
            : { height: virtualizer.getTotalSize(), position: 'relative' }
        }
      >
        {/*
         * One offset wrapper with the sections in normal flow. Positioning
         * each section absolutely at its estimated offset lets a mis-estimated
         * neighbour overlap it and swallow hovers meant for its gutter.
         */}
        <div
          className="diff-stream-window"
          style={
            unmeasured
              ? undefined
              : {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${items[0]?.start ?? 0}px)`,
                }
          }
        >
          {(unmeasured
            ? fallbackWindow.map((index) => ({ index }))
            : items
          ).map((item) => {
            const file = files[item.index]
            if (!file) return null
            return (
              <div
                className="diff-stream-item"
                // Not data-file-index: the rail already owns that attribute.
                data-stream-index={item.index}
                data-index={item.index}
                key={`${file.old_path}:${file.new_path}`}
                ref={measureSection}
              >
                <DiffFileSection
                  discussions={discussions}
                  file={file}
                  mode={mode}
                  reservedHeight={estimates[item.index]}
                  showComments={showComments}
                  theme={theme}
                  onInlineCountChange={(count) =>
                    reportInlineCount(item.index, count)
                  }
                  onRequestShowComments={onRequestShowComments}
                />
              </div>
            )
          })}
        </div>
      </div>
  )
}
