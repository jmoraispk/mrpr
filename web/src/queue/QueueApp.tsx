import { useEffect, useRef, useState } from 'react'

import type { MrOverview } from '../gitlab/mrOverview'
import { hubRequest } from '../hub/api'
import { describeHostError } from '../hub/hostErrors'
import { Settings } from '../hub/Settings'
import { useUnreadTitle } from '../hub/useInbox'
import { ACTIVE_POLL_MAX_AGE_MS } from '../inbox/types'
import { platform } from '../platform/platform'
import type { ReviewTarget } from '../transport/types'
import { KeyHelp } from './KeyHelp'
import { useSidebar } from './listSettings'
import type { QueueRow } from './model'
import { MrHeader, type HeaderRequest } from './mr/MrHeader'
import { MrOverviewView } from './mr/MrOverview'
import { MrPanel } from './mr/MrPanel'
import { RebaseControl } from './mr/RebaseControl'
import { NoticeBar } from './NoticeBar'
import { projectOf } from './projects'
import { ProjectsSettings } from './ProjectsSettings'
import { focusNoteOf, markRowRead } from './readState'
import { parseSiteRoute, reviewHash, type ReviewTab, type SiteRoute } from './route'
import { Sidebar } from './sidebar/Sidebar'
import { useSidebarList } from './sidebar/useSidebarList'
import { SnoozedPage } from './SnoozedPage'
import { useProjects } from './state'
import { useQueue } from './useQueue'
import { useQueueKeys } from './useQueueKeys'
import { useRowActions } from './useRowActions'

const REAUTH_CODES = new Set(['signed_out', 'gitlab_authentication_failed'])

function useSiteRoute(): SiteRoute {
  const [route, setRoute] = useState(() => parseSiteRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(parseSiteRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

const sameMr = (row: QueueRow, target: ReviewTarget) =>
  row.hostId === target.hostId && row.project === target.project && row.iid === target.iid

/** The signed-in site: every MR on the left, the open one (or settings, or snoozed) on the right. */
export function QueueApp() {
  const route = useSiteRoute()
  const queue = useQueue()
  const [projects] = useProjects()
  const list = useSidebarList(queue.rows, projects)
  const [sidebar, setSidebar] = useSidebar()
  const [selected, setSelected] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)
  const [headerRequest, setHeaderRequest] = useState<HeaderRequest | null>(null)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const actions = useRowActions()
  useUnreadTitle(
    queue.rows.filter((row) => !row.snoozed && !row.folded && row.attention === 'needs-you').length,
  )
  // Opening the queue is a sign the user is looking; catch up if the last
  // poll is stale rather than waiting up to two minutes for the next.
  useEffect(() => {
    void hubRequest('pollNow', { maxAgeMs: ACTIVE_POLL_MAX_AGE_MS }).catch(() => undefined)
  }, [])

  const openTarget = route.name === 'review' ? route.target : null
  const openRow = openTarget ? (queue.rows.find((row) => sameMr(row, openTarget)) ?? null) : null
  const openKey = openTarget ? `${openTarget.hostId}/${openTarget.project}/${openTarget.iid}` : null
  const openRowKey = openRow?.key ?? null
  // Opening an MR selects its row; an MR the list doesn't hold leaves nothing selected.
  useEffect(() => {
    if (openKey) setSelected(openRowKey)
  }, [openKey, openRowKey])

  const full = route.name === 'review' && route.full
  const showSidebar = sidebar.open && !full
  // What keys act on: with the sidebar hidden, the MR on screen. Otherwise the
  // selected row while the list shows it or it is the open MR; with nothing
  // selected and nothing open, the first row.
  const listed = new Set(list.flat.map((row) => row.key))
  const selectedRow = selected ? (queue.rows.find((row) => row.key === selected) ?? null) : null
  const current = !showSidebar
    ? openRow
    : selectedRow
      ? listed.has(selectedRow.key) || selectedRow.key === openRowKey
        ? selectedRow
        : null
      : openTarget
        ? null
        : (list.flat[0] ?? null)
  // Where the selected row sat, so j/k carry on from there once it leaves.
  const anchor = useRef<{ key: string; index: number } | null>(null)
  useEffect(() => {
    const index = selected ? list.flat.findIndex((row) => row.key === selected) : -1
    if (selected && index >= 0) anchor.current = { key: selected, index }
  })

  const open = (row: QueueRow, tab: ReviewTab = 'overview') => {
    markRowRead(row)
    setSelected(row.key)
    window.location.hash = reviewHash(
      { hostId: row.hostId, project: row.project, iid: row.iid },
      {
        tab,
        noteId: tab === 'overview' ? focusNoteOf(row) : null,
        full: route.name === 'review' && route.full,
      },
    )
  }
  // r, x, n and m start their action in the MR header, opening the selected MR first.
  const ask = (request: HeaderRequest) => {
    if (current && current.key !== openRowKey) open(current)
    else if (!openTarget) return
    setHeaderRequest(request)
  }

  useQueueKeys(
    {
      move(delta) {
        const rows = list.flat
        // With the sidebar hidden there is no selection to see: j and k open the next MR.
        if (!rows.length || (!showSidebar && !openTarget)) return
        const index = current ? rows.indexOf(current) : -1
        const last = rows.length - 1
        const left = index < 0 && anchor.current?.key === selected ? anchor.current : null
        const next =
          index >= 0
            ? rows[Math.min(last, Math.max(0, index + delta))]
            : left
              ? // The rows after it moved up into its place.
                rows[delta > 0 ? Math.min(left.index, last) : Math.max(left.index - 1, 0)]
              : rows[0]
        if (showSidebar) setSelected(next.key)
        else open(next)
      },
      open: () => current && open(current),
      diffSince: () => current && open(current, 'since'),
      // Escape, f and b read the address as it is now: a second key can land
      // before the screen has caught up with the first.
      close() {
        const now = parseSiteRoute(window.location.hash)
        if (now.name !== 'review') return
        window.location.hash = now.full
          ? reviewHash(now.target, { tab: now.tab, noteId: now.noteId })
          : '#/'
      },
      full() {
        const now = parseSiteRoute(window.location.hash)
        if (now.name !== 'review') return
        window.location.hash = reviewHash(now.target, {
          tab: now.tab,
          noteId: now.noteId,
          full: !now.full,
        })
      },
      sidebar() {
        const now = parseSiteRoute(window.location.hash)
        if (now.name === 'review' && now.full) {
          window.location.hash = reviewHash(now.target, { tab: now.tab, noteId: now.noteId })
          if (!sidebar.open) setSidebar({ open: true })
          return
        }
        setSidebar({ open: !sidebar.open })
      },
      search() {
        const now = parseSiteRoute(window.location.hash)
        if (now.name === 'review' && now.full) {
          window.location.hash = reviewHash(now.target, { tab: now.tab, noteId: now.noteId })
        }
        if (!sidebar.open) setSidebar({ open: true })
        setSearchFocus((count) => count + 1)
      },
      help: () => setHelpOpen((value) => !value),
      approve: () => current && actions.approve(current),
      snooze: () => current && actions.snooze(current),
      reply: () => ask('reply'),
      changes: () => ask('changes'),
      nudge: () => ask('nudge'),
      moveProject: () => ask('move'),
    },
    route.name !== 'settings',
  )
  const meFor = (hostId: string) =>
    queue.hosts.find((host) => host.hostId === hostId)?.username ?? ''
  const me = openTarget ? meFor(openTarget.hostId) : ''

  // Errors from either source: the queue's own fetch, or the inbox poll.
  const errors = new Map<string, { host: string; code: string }>()
  for (const host of queue.hosts) {
    if (host.error) errors.set(host.hostId, { host: host.host, code: host.error })
  }
  for (const host of queue.inbox?.hosts ?? []) {
    if (host.error && !errors.has(host.hostId)) {
      errors.set(host.hostId, { host: host.host, code: host.error.code })
    }
  }

  return (
    <div
      className={`q-shell${showSidebar ? '' : ' is-sidebar-hidden'}${openTarget ? ' has-mr' : ''}${
        route.name === 'settings' || route.name === 'snoozed' ? ' has-page' : ''
      }`}
    >
      {showSidebar ? (
        <Sidebar
          rows={queue.rows}
          list={list}
          loading={queue.isLoading}
          selectedKey={current?.key ?? null}
          openKey={openRowKey}
          onOpenRow={(row) => open(row)}
          searchFocus={searchFocus}
          onSearchFocused={() => setSearchFocus(0)}
          onSearchDone={() => {
            if (list.flat[0]) setSelected(list.flat[0].key)
          }}
        />
      ) : null}
      <main className="q-main-area">
        {route.name === 'queue' ? null : (
          // Narrow windows have no sidebar beside a page: this is the way back.
          <a className="q-back" href="#/">
            ← MRs
          </a>
        )}
        <NoticeBar notice={actions.notice} onUndo={actions.undo} onDismiss={actions.dismiss} />
        {[...errors.entries()].map(([hostId, error]) => (
          <p key={hostId} className="hub-error">
            {error.host}: {describeHostError(error.code)}{' '}
            {REAUTH_CODES.has(error.code) && !platform().needsToken ? (
              <button
                type="button"
                onClick={() =>
                  void platform().connectHost({
                    host: error.host,
                    apiBase: `https://${error.host}/api/v4`,
                  })
                }
              >
                Sign in again
              </button>
            ) : null}
          </p>
        ))}
        {route.name === 'settings' ? (
          <>
            <Settings />
            <ProjectsSettings />
          </>
        ) : route.name === 'snoozed' ? (
          <SnoozedPage rows={queue.rows} onUnsnooze={actions.snooze} />
        ) : route.name === 'review' ? (
          <MrPanel
            key={openKey}
            target={route.target}
            row={openRow}
            me={me}
            tab={route.tab}
            full={route.full}
            noteId={route.noteId}
            header={(overview) => {
              const target = route.target
              // An MR outside the queue still gets the queue's notice, from its overview.
              const asRow = openRow ?? (overview ? rowFromOverview(overview, target) : null)
              return (
                <MrHeader
                  target={target}
                  me={me}
                  row={openRow}
                  overview={overview}
                  full={route.full}
                  fullHref={reviewHash(target, {
                    tab: route.tab,
                    noteId: route.noteId,
                    full: !route.full,
                  })}
                  closeHref="#/"
                  onApprove={() => asRow && actions.approve(asRow)}
                  onSnooze={() => openRow && actions.snooze(openRow)}
                  onReply={(id) => {
                    setReplyTo(id)
                    if (route.tab !== 'overview') {
                      window.location.hash = reviewHash(target, { full: route.full })
                    }
                  }}
                  request={headerRequest}
                  onRequestHandled={() => setHeaderRequest(null)}
                />
              )
            }}
            overview={(overview, previous) => {
              const project = openRow ? projectOf(openRow, projects) : null
              return (
                <MrOverviewView
                  overview={overview}
                  target={route.target}
                  me={me}
                  previous={previous}
                  replyTo={replyTo}
                  onReplied={() => setReplyTo(null)}
                  projectName={project?.name ?? null}
                  projectColor={project?.color ?? null}
                  rebase={<RebaseControl overview={overview} target={route.target} />}
                  focusNoteId={route.noteId}
                />
              )
            }}
          />
        ) : (
          <div className="q-welcome">
            <p>Click an MR to open it.</p>
            <p className="q-muted">
              <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Enter</kbd> open · <kbd>?</kbd> all keys
            </p>
          </div>
        )}
      </main>
      <KeyHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

/** A stand-in queue row for an MR the queue doesn't list, so actions can name it. */
function rowFromOverview(overview: MrOverview, target: ReviewTarget): QueueRow {
  return {
    key: `${target.hostId}:${target.project}!${target.iid}`,
    hostId: target.hostId,
    host: target.hostId,
    mr: null,
    project: target.project,
    iid: target.iid,
    title: overview.title,
    webUrl: overview.webUrl,
    updatedAt: overview.updatedAt,
    score: 0,
    tags: [],
    attention: 'done',
    folded: false,
    minutes: 0,
    newCommits: 0,
    items: [],
    snoozed: false,
  }
}
