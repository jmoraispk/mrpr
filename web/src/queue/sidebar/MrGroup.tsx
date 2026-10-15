import { useRef, useState, type DragEvent, type ReactNode } from 'react'

import type { RowGroup } from '../order'
import { GroupMenu } from './GroupMenu'

type Place = 'before' | 'after'
const GROUP = 'text/mrpr-group'
const ROW = 'text/mrpr-row'
const carries = (event: DragEvent, type: string) => [...(event.dataTransfer.types ?? [])].includes(type)
// Above the header's middle drops before it; at or below, after.
const placeOf = (event: DragEvent<HTMLElement>): Place => {
  const box = event.currentTarget.getBoundingClientRect()
  return event.clientY < box.top + box.height / 2 ? 'before' : 'after'
}

/** A project or a repository: a header that folds it, with its ⋮ menu, then its rows. */
export function MrGroup({
  group,
  collapsed,
  onToggle,
  onDropRow,
  onDropGroup,
  onRename,
  onMute,
  onMove,
  canUp,
  canDown,
  children,
}: {
  group: RowGroup
  collapsed: boolean
  onToggle: () => void
  onDropRow: (rowKey: string) => void
  onDropGroup: (id: string, place: Place) => void
  /** Save a name; false keeps the field open (a project's name cannot be empty). */
  onRename: (name: string) => boolean
  /** Only a repository's group can be muted. */
  onMute?: () => void
  onMove: (delta: -1 | 1) => void
  canUp: boolean
  canDown: boolean
  children: ReactNode
}) {
  const takesRows = group.projectId !== null
  const [renaming, setRenaming] = useState(false)
  const [dropAt, setDropAt] = useState<Place | null>(null)
  // Enter saves, and the field's blur as it goes must not save again.
  const saved = useRef(false)

  const commit = (value: string) => {
    if (saved.current) return
    if (onRename(value)) {
      saved.current = true
      setRenaming(false)
    }
  }

  const accepts = (event: DragEvent) => carries(event, GROUP) || (takesRows && !carries(event, 'Files'))
  return (
    <section className="sb-group" aria-label={group.name}>
      <h2
        className={`sb-group-head${dropAt ? ` is-drop-${dropAt}` : ''}`}
        onDragOver={(event) => {
          if (!accepts(event)) return
          event.preventDefault()
          setDropAt(carries(event, GROUP) ? placeOf(event) : null)
        }}
        onDragLeave={() => setDropAt(null)}
        onDrop={(event) => {
          setDropAt(null)
          const id = event.dataTransfer.getData(GROUP)
          if (id) {
            event.preventDefault()
            onDropGroup(id, placeOf(event))
            return
          }
          const key = takesRows ? event.dataTransfer.getData(ROW) : ''
          if (key) {
            event.preventDefault()
            onDropRow(key)
          }
        }}
      >
        {renaming ? (
          <input
            className="sb-rename"
            aria-label={`Rename ${group.name}`}
            defaultValue={group.name}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit(event.currentTarget.value)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                saved.current = true
                setRenaming(false)
              }
            }}
            onBlur={(event) => commit(event.currentTarget.value)}
          />
        ) : (
          <button
            type="button"
            className="sb-group-toggle"
            aria-expanded={!collapsed}
            onClick={onToggle}
            draggable
            onDragStart={(event) => event.dataTransfer.setData(GROUP, group.id)}
          >
            <span className="sb-chevron" aria-hidden="true">
              {collapsed ? '▸' : '▾'}
            </span>
            {group.color ? <span className="q-dot" style={{ background: group.color }} /> : null}
            <span className="sb-group-name">{group.name}</span>
            <span className="sb-count">
              {group.needsYou} / {group.rows.length}
            </span>
          </button>
        )}
        <GroupMenu
          name={group.name}
          canMute={Boolean(onMute)}
          canUp={canUp}
          canDown={canDown}
          onRename={() => {
            saved.current = false
            setRenaming(true)
          }}
          onMute={() => onMute?.()}
          onUp={() => onMove(-1)}
          onDown={() => onMove(1)}
        />
      </h2>
      {collapsed ? null : children}
    </section>
  )
}
