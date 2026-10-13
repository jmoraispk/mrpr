import { useEffect, useRef } from 'react'

export interface QueueKeyHandlers {
  move(delta: 1 | -1): void
  /** Space: expand or fold the selected row. */
  toggle(): void
  open(): void
  approve(): void
  reply(): void
  changes(): void
  nudge(): void
  snooze(): void
  moveProject(): void
  diffSince(): void
  /** /: the search box. */
  search(): void
  /** b or Ctrl+B: hide or show the sidebar. */
  sidebar(): void
  help(): void
  /** Escape: fold the expanded row, else leave full screen, else close the MR. */
  close(): void
  /** f: full screen on or off. */
  full(): void
}

/** Typing in a field, or pressing Enter or Space on a control, is never a shortcut. */
function belongsToTarget(event: KeyboardEvent): boolean {
  const element = event.target as HTMLElement | null
  if (!element?.tagName) return false
  if (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  ) {
    return true
  }
  return (
    (event.key === 'Enter' || event.key === ' ') &&
    (element.tagName === 'A' || element.tagName === 'BUTTON' || element.tagName === 'SUMMARY')
  )
}

/** The queue's keyboard: one key per action, and Ctrl+B as in editors. */
export function useQueueKeys(handlers: QueueKeyHandlers, enabled = true): void {
  const latest = useRef({ handlers, enabled })
  useEffect(() => {
    latest.current = { handlers, enabled }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!latest.current.enabled || belongsToTarget(event)) return
      const h = latest.current.handlers
      // The one shortcut with a modifier.
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'b'
      ) {
        event.preventDefault()
        h.sidebar()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const actions: Record<string, () => void> = {
        j: () => h.move(1),
        k: () => h.move(-1),
        ' ': () => h.toggle(),
        Enter: () => h.open(),
        o: () => h.open(),
        a: () => h.approve(),
        r: () => h.reply(),
        x: () => h.changes(),
        n: () => h.nudge(),
        s: () => h.snooze(),
        m: () => h.moveProject(),
        d: () => h.diffSince(),
        '/': () => h.search(),
        b: () => h.sidebar(),
        '?': () => h.help(),
        Escape: () => h.close(),
        f: () => h.full(),
      }
      const action = actions[event.key]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
