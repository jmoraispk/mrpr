import { useEffect, useRef, useState } from 'react'

import { useMutedGroups } from '../groups'
import { useFiltersOpen } from '../listSettings'
import type { QueueRow } from '../model'
import {
  directionLabel,
  FIRST_DESCENDING,
  SORTS,
  SORT_LABELS,
  TAB_LABELS,
  TABS,
  filterRows,
  type RowGroup,
  type SidebarView,
  type SortBy,
} from '../order'
import { ProjectDialog } from '../ProjectDialog'
import { moveRow } from '../projects'
import { useProjects } from '../state'
import { useTheme } from '../theme'
import { FiltersPanel } from './FiltersPanel'
import { MrGroup } from './MrGroup'
import { MrRow } from './MrRow'
import { RefreshButton } from './RefreshButton'
import { SidebarResizer } from './SidebarResizer'
import type { SidebarList } from './useSidebarList'

export interface SidebarProps {
  /** Every row, for the header and footer counts. */
  rows: QueueRow[]
  list: SidebarList
  loading: boolean
  selectedKey: string | null
  /** The row of the MR open on the right. */
  openKey: string | null
  /** The open MR's look key, for the Activity filters; null with no MR open. */
  activityKey: string | null
  onOpenRow: (row: QueueRow) => void
  onSnoozeRow: (row: QueueRow) => void
  /** ⋮ → Mute repository on a repository's group. */
  onMuteGroup: (group: RowGroup) => void
  /** ⋮ → Unmute on a muted repository's group (snoozed view). */
  onUnmuteGroup: (id: string) => void
  /** Which list the sidebar shows, and the footer's toggle between them. */
  view: SidebarView
  onToggleView: () => void
  /** Non-zero when `/` asks for the search box; reset through onSearchFocused. */
  searchFocus: number
  onSearchFocused: () => void
  /** Enter or ↓ in the search box: on to the results. */
  onSearchDone: () => void
  width: number
  /** When the list was last read (ms), whether it is being read, and a way to read it now. */
  updatedAt: number
  refreshing: boolean
  onRefresh: () => void
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
}

/** Every MR, grouped by project, with the filters, sort and tag chips that order them. */
export function Sidebar({
  rows,
  list,
  loading,
  selectedKey,
  openKey,
  activityKey,
  onOpenRow,
  onSnoozeRow,
  onMuteGroup,
  onUnmuteGroup,
  view,
  onToggleView,
  searchFocus,
  onSearchFocused,
  onSearchDone,
  width,
  updatedAt,
  refreshing,
  onRefresh,
  onResize,
  onResizeEnd,
}: SidebarProps) {
  const [projects, setProjects] = useProjects()
  const theme = useTheme()
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useFiltersOpen()
  const [muted] = useMutedGroups()
  // The toggles that are on, plus one when Show is not the default (yours and your reviews).
  const activeFilters =
    [list.filters.needsMeOnly, list.filters.hideDrafts, list.filters.showDone].filter(Boolean).length +
    (list.filters.allMrs || !list.filters.authored || !list.filters.reviewing ? 1 : 0)
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
  // What the Active list would hold, both tabs, without a search.
  const activeCount = filterRows(rows, list.filters, '').length

  // A project's rename is the project's own; a repository's is a display name in this browser.
  const renameGroup = (group: RowGroup, value: string): boolean => {
    const name = value.trim()
    if (group.projectId) {
      if (!name) return false
      setProjects(projects.map((project) => (project.id === group.projectId ? { ...project, name } : project)))
      return true
    }
    const names = { ...list.names }
    if (!name || name === group.repo) delete names[group.id]
    else names[group.id] = name
    list.setNames(names)
    return true
  }

  let body
  if (loading) body = <p className="sb-empty">Loading your queue…</p>
  else if (list.groups.length > 0) {
    body = list.groups.map((group, index) => (
      <MrGroup
        key={group.id}
        group={group}
        collapsed={list.collapsed.includes(group.id)}
        onToggle={() => list.toggleGroup(group.id)}
        onDropRow={(key) => setProjects(moveRow(projects, key, group.projectId))}
        onDropGroup={(id, place) => list.moveGroup(id, group.id, place)}
        onRename={(value) => renameGroup(group, value)}
        onMute={
          group.repo ? () => (group.muted ? onUnmuteGroup(group.id) : onMuteGroup(group)) : undefined
        }
        onMove={(delta) => list.shiftGroup(group.id, delta)}
        canUp={index > 0}
        canDown={index < list.groups.length - 1}
      >
        {group.rows.map((row) => (
          <MrRow
            key={row.key}
            row={row}
            selected={row.key === selectedKey}
            current={row.key === openKey}
            onOpen={() => onOpenRow(row)}
            onSnooze={() => onSnoozeRow(row)}
            action={view === 'snoozed' ? (row.snoozed ? 'unsnooze' : null) : 'snooze'}
          />
        ))}
      </MrGroup>
    ))
  } else if (view === 'snoozed' && !list.narrowed) {
    body = <p className="sb-empty">Nothing snoozed.</p>
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
        {list.tab === 'mine' ? 'No open MRs from you.' : 'Nothing waiting on you.'}
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
        <RefreshButton updatedAt={updatedAt} refreshing={refreshing} onRefresh={onRefresh} />
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
        <div className="sb-sort-row">
          <label className="sb-sort">
            Sort
            <select
              value={list.order.sortBy}
              onChange={(event) => {
                const sortBy = event.target.value as SortBy
                list.setOrder({ sortBy, descending: FIRST_DESCENDING[sortBy] })
              }}
            >
              {SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="sb-direction"
            aria-label={directionLabel(list.order)}
            title={`${directionLabel(list.order)} · click to flip`}
            onClick={() => list.setOrder({ ...list.order, descending: !list.order.descending })}
          >
            {list.order.descending ? '↓' : '↑'}
          </button>
          <button
            type="button"
            className="sb-filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls="sb-filters-panel"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            Filters{activeFilters ? ` · ${activeFilters}` : ''} {filtersOpen ? '▴' : '▾'}
          </button>
        </div>
        {filtersOpen ? (
          <FiltersPanel filters={list.filters} onFilters={list.setFilters} activityKey={activityKey} />
        ) : null}
        <div className="sb-tabs" role="tablist" aria-label="Whose MRs">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="sb-tab"
              aria-selected={list.tab === id}
              tabIndex={list.tab === id ? 0 : -1}
              data-tab={id}
              onClick={() => list.setTab(id)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                const next = TABS[(TABS.indexOf(id) + 1) % TABS.length]
                list.setTab(next)
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
                  ?.focus()
              }}
            >
              {TAB_LABELS[id]} ({list.counts[id]})
            </button>
          ))}
        </div>
      </div>
      <div className="sb-groups" role="tabpanel" aria-label={TAB_LABELS[list.tab]}>
        {body}
      </div>
      <footer className="sb-foot">
        {folded ? (
          <p className="q-folded">
            {folded} bot MR{folded === 1 ? '' : 's'} folded away
          </p>
        ) : null}
        <nav aria-label="More">
          <button
            type="button"
            className="sb-view-toggle"
            aria-pressed={view === 'snoozed'}
            onClick={onToggleView}
          >
            {view === 'snoozed'
              ? `Active (${activeCount})`
              : `Snoozed (${snoozed + Object.keys(muted).length})`}
          </button>
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
