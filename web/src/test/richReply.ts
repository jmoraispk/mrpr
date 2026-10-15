import type { Editor } from '@tiptap/react'
import { act, waitFor } from '@testing-library/react'

// The editor is loaded lazily; under a full parallel test run that can take a while.
const LAZY = { timeout: 5000 }

/** The Tiptap editor behind a live rich reply box (Tiptap sets it on its element). */
export function richEditor(box: HTMLElement): Editor {
  const editor = (box as HTMLElement & { editor?: Editor }).editor
  if (!editor) throw new Error('not a live rich reply box')
  return editor
}

/** The live editor element for a box, activating an idle one (focus) first. */
export async function activeBox(box: HTMLElement): Promise<HTMLElement> {
  if ((box as HTMLElement & { editor?: Editor }).editor) return box
  const label = box.getAttribute('aria-label') ?? ''
  act(() => box.focus())
  return waitFor(() => {
    const live = [...document.querySelectorAll<HTMLElement>('.rich-reply-input')].find(
      (element) => element.getAttribute('aria-label') === label,
    )
    if (!live || !(live as HTMLElement & { editor?: Editor }).editor) {
      throw new Error('editor not ready')
    }
    return live
  }, LAZY)
}

/** Types plain text at the end: jsdom cannot drive contenteditable typing. */
export async function typeRich(box: HTMLElement, text: string): Promise<HTMLElement> {
  const live = await activeBox(box)
  await act(async () => {
    richEditor(live).chain().focus('end').insertContent(text).run()
  })
  return live
}

/** Waits for a live (started) rich reply box, the one with this label if given. */
export function liveBox(label?: string): Promise<HTMLElement> {
  return waitFor(() => {
    const live = [...document.querySelectorAll<HTMLElement>('.rich-reply-input')].find(
      (element) => !label || element.getAttribute('aria-label') === label,
    )
    if (!live || !(live as HTMLElement & { editor?: Editor }).editor) throw new Error('no live box')
    return live
  }, LAZY)
}
