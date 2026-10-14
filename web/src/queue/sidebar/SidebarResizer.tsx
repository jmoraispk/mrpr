import { useRef } from 'react'

import { clampWidth, SIDEBAR_WIDTH } from '../listSettings'

/** The sidebar's right edge: drag it, use the arrow keys, or double-click to reset. */
export function SidebarResizer({
  width,
  onResize,
  onResizeEnd,
}: {
  width: number
  /** While dragging: the width to show now. */
  onResize: (width: number) => void
  /** The width to keep. */
  onResizeEnd: (width: number) => void
}) {
  const left = useRef<number | null>(null)
  const widthAt = (clientX: number) => clampWidth(clientX - (left.current ?? 0))
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      className="sb-resize"
      onPointerDown={(event) => {
        // The main button only: a right-click's menu would swallow the release.
        if (event.button !== 0) return
        event.preventDefault()
        left.current = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0
        // jsdom has no pointer capture.
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (left.current !== null) onResize(widthAt(event.clientX))
      }}
      onPointerUp={(event) => {
        if (left.current === null) return
        onResizeEnd(widthAt(event.clientX))
        left.current = null
      }}
      // Cancelled (a touch taken over, the window losing the pointer): end the
      // drag and keep the width it started from.
      onPointerCancel={() => {
        if (left.current === null) return
        left.current = null
        onResizeEnd(width)
      }}
      onLostPointerCapture={() => {
        if (left.current === null) return
        left.current = null
        onResizeEnd(width)
      }}
      onDoubleClick={() => onResizeEnd(SIDEBAR_WIDTH.default)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16
        const next =
          event.key === 'ArrowLeft'
            ? width - step
            : event.key === 'ArrowRight'
              ? width + step
              : event.key === 'Home'
                ? SIDEBAR_WIDTH.default
                : null
        if (next === null) return
        event.preventDefault()
        onResizeEnd(clampWidth(next))
      }}
    />
  )
}
