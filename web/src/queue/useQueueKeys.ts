import { useEffect, useRef } from 'react'

import type { Bucket } from './model'

export interface QueueKeyHandlers {
  move(delta: 1 | -1): void
  open(): void
  approve(): void
  reply(): void
  changes(): void
  nudge(): void
  snooze(): void
  moveProject(): void
  diffSince(): void
  jump(bucket: Bucket): void
  jumpProject(): void
  help(): void
  /** Escape: leave full screen, else close the MR. */
  close(): void
  /** f: full screen on or off. */
  full(): void
}

const JUMPS: Record<string, Bucket> = {
  n: 'needs-you',
  r: 'returned',
  w: 'waiting',
  q: 'quick-wins',
}

/** Typing in a field, or pressing Enter on a control, is never a shortcut. */
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
  return event.key === 'Enter' && (element.tagName === 'A' || element.tagName === 'BUTTON')
}

/** The queue's keyboard: one key per action, `g` then a letter to jump. */
export function useQueueKeys(handlers: QueueKeyHandlers, enabled = true): void {
  const latest = useRef({ handlers, enabled })
  useEffect(() => {
    latest.current = { handlers, enabled }
  })
  useEffect(() => {
    let pendingG = false
    const onKey = (event: KeyboardEvent) => {
      if (!latest.current.enabled) return
      if (event.ctrlKey || event.metaKey || event.altKey || belongsToTarget(event)) return
      const h = latest.current.handlers
      if (pendingG) {
        pendingG = false
        if (event.key === 'p') h.jumpProject()
        else if (JUMPS[event.key]) h.jump(JUMPS[event.key])
        else return
        event.preventDefault()
        return
      }
      const actions: Record<string, () => void> = {
        j: () => h.move(1),
        k: () => h.move(-1),
        Enter: () => h.open(),
        o: () => h.open(),
        a: () => h.approve(),
        r: () => h.reply(),
        x: () => h.changes(),
        n: () => h.nudge(),
        s: () => h.snooze(),
        m: () => h.moveProject(),
        d: () => h.diffSince(),
        '?': () => h.help(),
        Escape: () => h.close(),
        f: () => h.full(),
        g: () => {
          pendingG = true
        },
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
