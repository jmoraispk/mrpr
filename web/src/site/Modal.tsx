import { useEffect, useRef, type ReactNode } from 'react'

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
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    // jsdom has no showModal.
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
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
