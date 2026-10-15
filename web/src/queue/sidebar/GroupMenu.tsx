import { useEffect, useRef, useState } from 'react'

interface Item {
  label: string
  disabled: boolean
  run: () => void
}

/** The ⋮ on a group header: Rename…, Mute repository (or Unmute), Move up, Move down. */
export function GroupMenu({
  name,
  canMute,
  muted = false,
  canUp,
  canDown,
  onRename,
  onMute,
  onUp,
  onDown,
}: {
  name: string
  canMute: boolean
  /** A muted repository: the menu offers Unmute (onMute) instead. */
  muted?: boolean
  canUp: boolean
  canDown: boolean
  onRename: () => void
  onMute: () => void
  onUp: () => void
  onDown: () => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const items: Item[] = [
    { label: 'Rename…', disabled: false, run: onRename },
    ...(canMute ? [{ label: muted ? 'Unmute' : 'Mute repository', disabled: false, run: onMute }] : []),
    { label: 'Move up', disabled: !canUp, run: onUp },
    { label: 'Move down', disabled: !canDown, run: onDown },
  ]
  const enabledItems = () => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
  ]

  useEffect(() => {
    if (!open) return
    enabledItems()[0]?.focus()
    const outside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  return (
    <span className="sb-menu-wrap">
      <button
        ref={trigger}
        type="button"
        className="sb-menu-button"
        aria-label={`Options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ⋮
      </button>
      {open ? (
        <div
          ref={menu}
          className="sb-menu"
          role="menu"
          aria-label={`Options for ${name}`}
          onKeyDown={(event) => {
            const enabled = enabledItems()
            const at = enabled.indexOf(document.activeElement as HTMLButtonElement)
            if (event.key === 'Escape') {
              event.preventDefault()
              // The queue's own Escape (close the MR) must not see this one.
              event.stopPropagation()
              close(true)
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              enabled[(at + step + enabled.length) % enabled.length]?.focus()
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                // Rename moves focus to its field; everything else hands it back to ⋮.
                close(item.label !== 'Rename…')
                item.run()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  )
}
