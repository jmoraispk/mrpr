import { useEffect, useRef, useState } from 'react'

import { toggleTag } from '../listSettings'
import { todaysBudget, type QueueRow } from '../model'
import { SORTS, SORT_LABELS, type ListFilters, type SortBy } from '../order'
import { ProjectDialog } from '../ProjectDialog'
import { moveRow } from '../projects'
import { useProjects } from '../state'
import { useTheme } from '../theme'
import { MrGroup } from './MrGroup'
import { MrRow } from './MrRow'
import { SidebarResizer } from './SidebarResizer'
import { TagBar } from './TagBar'
import type { SidebarList } from './useSidebarList'

export interface SidebarProps {
  /** Every row, for the header and footer counts. */
  rows: QueueRow[]
  list: SidebarList
  loading: boolean
  selectedKey: string | null
  /** The row of the MR open on the right. */
  openKey: string | null
  onOpenRow: (row: QueueRow) => void
  onSnoozeRow: (row: QueueRow) => void
  /** Non-zero when `/` asks for the search box; reset through onSearchFocused. */
  searchFocus: number
  onSearchFocused: () => void
  /** Enter or ↓ in the search box: on to the results. */
  onSearchDone: () => void
  width: number
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
}

const FILTER_LABELS: [keyof ListFilters, string][] = [
  ['needsMeOnly', 'Needs me only'],
  ['hideDrafts', 'Hide drafts'],
  ['showDone', 'Show done'],
]

/** Every MR, grouped by project, with the filters, sort and tag chips that order them. */
export function Sidebar({
  rows,
  list,
  loading,
  selectedKey,
  openKey,
  onOpenRow,
  onSnoozeRow,
  searchFocus,
  onSearchFocused,
  onSearchDone,
  width,
  onResize,
  onResizeEnd,
}: SidebarProps) {
  const [projects, setProjects] = useProjects()
  const theme = useTheme()
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  // Focus once per ask: the sidebar mounting again (after full screen, or b) must not take it.
  useEffect(() => {
    if (!searchFocus) return
    search.current?.focus()
    onSearchFocused()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFocus])

  const live = rows.filter((row) => !row.folded && !row.snoozed)
  const needsYou = live.filter((row) => row.attention === 'needs-you').length
  const hiddenDone = live.filter((row) => row.attention === 'done').length
  const folded = rows.filter((row) => row.folded).length
  const snoozed = rows.filter((row) => row.snoozed && !row.folded).length

  let body
  if (loading) body = <p className="sb-empty">Loading your queue…</p>
  else if (list.groups.length > 0) {
    body = list.groups.map((group) => (
      <MrGroup
        key={group.id}
        group={group}
        collapsed={list.collapsed.includes(group.id)}
        onToggle={() => list.toggleGroup(group.id)}
        onDropRow={(key) => setProjects(moveRow(projects, key, group.projectId))}
      >
        {group.rows.map((row) => (
          <MrRow
            key={row.key}
            row={row}
            order={list.order.tags}
            selected={row.key === selectedKey}
            current={row.key === openKey}
            onOpen={() => onOpenRow(row)}
            onSnooze={() => onSnoozeRow(row)}
          />
        ))}
      </MrGroup>
    ))
  } else if (list.narrowed) {
    body = (
      <p className="sb-empty">
        No MRs match ·{' '}
        <button type="button" onClick={list.clear}>
          Clear filters
        </button>
      </p>
    )
  } else {
    body = (
      <p className="sb-empty">
        Nothing waiting on you.
        {!list.filters.showDone && hiddenDone ? (
          <>
            {' '}
            <button type="button" onClick={() => list.setFilters({ ...list.filters, showDone: true })}>
              Show {hiddenDone} done
            </button>
          </>
        ) : null}
      </p>
    )
  }

  return (
    <aside className="sb" aria-label="Merge requests">
      <header className="sb-head">
        <a className="q-brand" href="#/">
          Mr. PR
        </a>
        <p className="sb-need">
          {needsYou} need{needsYou === 1 ? 's' : ''} you
        </p>
        <p className="sb-budget">~{todaysBudget(rows)} min today</p>
      </header>
      <div className="sb-controls">
        <input
          ref={search}
          type="search"
          className="sb-search"
          placeholder="Search MRs   /"
          aria-label="Search MRs"
          value={list.search}
          onChange={(event) => list.setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'ArrowDown') {
              event.preventDefault()
              event.currentTarget.blur()
              onSearchDone()
            }
            if (event.key === 'Escape') {
              list.setSearch('')
              event.currentTarget.blur()
            }
          }}
        />
        <fieldset className="sb-filters">
          <legend className="visually-hidden">Filters</legend>
          {FILTER_LABELS.map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={list.filters[key]}
                onChange={(event) => list.setFilters({ ...list.filters, [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="sb-sort">
          Sort
          <select
            value={list.order.sortBy}
            onChange={(event) => list.setOrder({ ...list.order, sortBy: event.target.value as SortBy })}
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>
        <TagBar
          chips={list.chips}
          onToggle={(kind) => list.setOrder(toggleTag(list.order, kind))}
          onClear={() => list.setOrder({ ...list.order, tags: [] })}
        />
      </div>
      <div className="sb-groups">{body}</div>
      <footer className="sb-foot">
        {folded ? (
          <p className="q-folded">
            {folded} bot MR{folded === 1 ? '' : 's'} folded away
          </p>
        ) : null}
        <nav aria-label="More">
          <a href="#/snoozed">Snoozed ({snoozed})</a>
          <a href="#/settings">Settings</a>
          <button
            type="button"
            onClick={() => theme.setChoice(theme.theme === 'dark' ? 'light' : 'dark')}
          >
            {theme.theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" onClick={() => setNewProjectOpen((open) => !open)}>
            + Project
          </button>
        </nav>
        {newProjectOpen ? <ProjectDialog onClose={() => setNewProjectOpen(false)} /> : null}
      </footer>
      <SidebarResizer width={width} onResize={onResize} onResizeEnd={onResizeEnd} />
    </aside>
  )
}
