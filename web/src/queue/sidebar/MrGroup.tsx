import type { ReactNode } from 'react'

import type { RowGroup } from '../order'

/** A project or a repository: a header that folds it, then its rows. A project's header takes dropped rows. */
export function MrGroup({
  group,
  collapsed,
  onToggle,
  onDropRow,
  children,
}: {
  group: RowGroup
  collapsed: boolean
  onToggle: () => void
  onDropRow: (rowKey: string) => void
  children: ReactNode
}) {
  const takesDrops = group.projectId !== null
  return (
    <section className="sb-group" aria-label={group.name}>
      <h2 className="sb-group-head">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          onDragOver={takesDrops ? (event) => event.preventDefault() : undefined}
          onDrop={
            takesDrops
              ? (event) => {
                  event.preventDefault()
                  const key = event.dataTransfer.getData('text/mrpr-row')
                  if (key) onDropRow(key)
                }
              : undefined
          }
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
      </h2>
      {collapsed ? null : children}
    </section>
  )
}
