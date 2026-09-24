import type { DiffFile, Discussion } from '../api/types'
import { discussionRange } from './discussionRange'

export type NoteLocation =
  | { kind: 'inline'; discussionId: string; fileIndex: number }
  | { kind: 'general'; discussionId: string }

/**
 * Where the review view shows a note, by the same rules the views use. A
 * discussion with no positioned note is in the MR discussions panel (see
 * `generalDiscussions` in `App.tsx`). One with a position shows inline in the
 * file `discussionRange` places it in, unless that file's diff is not shown
 * (collapsed or too large). A positioned discussion that no shown file places
 * renders nowhere, so it counts as not found.
 */
export function locateNote(
  discussions: Discussion[],
  files: DiffFile[],
  noteId: number,
): NoteLocation | null {
  const discussion = discussions.find((candidate) =>
    candidate.notes.some((note) => Number(note.id) === noteId),
  )
  if (!discussion) return null
  if (discussion.notes.every((note) => !note.position)) {
    return { kind: 'general', discussionId: discussion.id }
  }
  const fileIndex = files.findIndex(
    (file) =>
      !file.collapsed &&
      !file.too_large &&
      discussionRange(discussion, file) !== null,
  )
  return fileIndex < 0
    ? null
    : { kind: 'inline', discussionId: discussion.id, fileIndex }
}

const FLASH_CLASS = 'thread-flash'
const FLASH_MS = 2_000
/** How long to wait for the thread to mount (lazy panel, diff build). */
const WAIT_MS = 8_000
const RETRY_MS = 50

/**
 * Focuses a thread as soon as it is in the document, and marks it briefly so
 * the eye finds it. `scroll` is off for inline threads, whose scrolling the
 * diff stream owns. `onMissing` runs once if the thread never appears, e.g. a
 * comment on a line outside every hunk of the current diff.
 */
export function focusThread(
  discussionId: string,
  { scroll, onMissing }: { scroll: boolean; onMissing?: () => void },
): () => void {
  let cancelled = false
  let timer = 0
  const started = Date.now()
  const attempt = () => {
    if (cancelled) return
    const thread = Array.from(
      document.querySelectorAll<HTMLElement>('[data-discussion-id]'),
    ).find((element) => element.dataset.discussionId === discussionId)
    if (!thread) {
      if (Date.now() - started < WAIT_MS) {
        timer = window.setTimeout(attempt, RETRY_MS)
      } else {
        onMissing?.()
      }
      return
    }
    // jsdom has no scrollIntoView.
    if (scroll) thread.scrollIntoView?.({ block: 'center' })
    thread.focus({ preventScroll: true })
    thread.classList.add(FLASH_CLASS)
    timer = window.setTimeout(() => thread.classList.remove(FLASH_CLASS), FLASH_MS)
  }
  attempt()
  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}
