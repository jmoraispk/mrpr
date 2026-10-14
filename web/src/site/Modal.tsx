import { useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * A modal dialog over the app: focus stays inside, Escape cancels, and the
 * queue's keys stay quiet while it is open (they look for `dialog.q-modal[open]`).
 */
export function Modal({
  label,
  onCancel,
  children,
}: {
  label: string
  onCancel: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // A layout effect: its cleanup runs before the dialog leaves the page, so
  // focus can be handed back to whatever had it before the dialog opened.
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const before = document.activeElement as HTMLElement | null
    if (!dialog.open) {
      // jsdom has no showModal.
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      before?.focus?.()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="q-modal q-tokens"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      {children}
    </dialog>
  )
}
