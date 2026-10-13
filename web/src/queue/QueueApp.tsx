import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { MrOverview } from '../gitlab/mrOverview'
import { hubRequest } from '../hub/api'
import { describeHostError } from '../hub/hostErrors'
import { Settings } from '../hub/Settings'
import { useUnreadTitle } from '../hub/useInbox'
import { ACTIVE_POLL_MAX_AGE_MS } from '../inbox/types'
import { platform } from '../platform/platform'
import type { ReviewTarget } from '../transport/types'
import { KeyHelp } from './KeyHelp'
import { BUCKET_LABELS, BUCKET_ORDER, todaysBudget, type QueueRow } from './model'
import { ProjectDialog } from './ProjectDialog'
import { moveRow, projectOf, projectsFromRepositories } from './projects'
import { ProjectsSettings } from './ProjectsSettings'
import { NoticeBar } from './NoticeBar'
import { QueueList } from './QueueList'
import { focusNoteOf, markRowRead } from './readState'
import { MrHeader, type HeaderRequest } from './mr/MrHeader'
import { MrOverviewView } from './mr/MrOverview'
import { MrPanel } from './mr/MrPanel'
import { RebaseControl } from './mr/RebaseControl'
import { listHash, parseSiteRoute, reviewHash, type ReviewTab, type SiteRoute } from './route'
import { useProjects } from './state'
import { useTheme } from './theme'
import { useQueue } from './useQueue'
import { useQueueKeys } from './useQueueKeys'
import { useRowActions } from './useRowActions'

const needsYouHeading = (count: number) =>
  count === 1 ? '1 review needs you' : `${count} reviews need you`

/** The project route for MRs no project claims. Project ids are random base-36, never this. */
const UNSORTED = 'unsorted'
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

/** The signed-in site: the review queue, projects, settings and the review view. */
export function QueueApp() {
  const route = useSiteRoute()
  const queue = useQueue()
  const [projects, setProjects] = useProjects()
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const theme = useTheme()
  const [selected, setSelected] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const actions = useRowActions()
  useUnreadTitle(queue.counts['needs-you'] + queue.counts['quick-wins'])
  // Opening the queue is a sign the user is looking; catch up if the last
  // poll is stale rather than waiting up to two minutes for the next.
  useEffect(() => {
    void hubRequest('pollNow', { maxAgeMs: ACTIVE_POLL_MAX_AGE_MS }).catch(() => undefined)
  }, [])
  // The list an MR was opened from, so closing it returns there.
  const [listRoute, setListRoute] = useState<SiteRoute>(() =>
    route.name === 'review' || route.name === 'settings' ? { name: 'queue', bucket: null } : route,
  )
  useEffect(() => {
    if (route.name !== 'review' && route.name !== 'settings') setListRoute(route)
  }, [route])
  const shown = route.name === 'review' ? listRoute : route

  const inProject = (id: string) => (row: QueueRow) =>
    id === UNSORTED ? projectOf(row, projects) === null : projectOf(row, projects)?.id === id
  // A project's view keeps Waiting and Done too, so nothing in it is forgotten.
  // Snoozed rows show only on their own list, where `s` brings them back.
  const listed =
    shown.name === 'snoozed'
      ? queue.rows.filter((row) => row.snoozed)
      : (shown.name === 'project'
          ? queue.rows.filter((row) => row.bucket !== 'folded' && inProject(shown.id)(row))
          : shown.name === 'queue' && shown.bucket
            ? queue.rows.filter((row) => row.bucket === shown.bucket)
            : queue.rows.filter((row) => row.bucket !== 'done' && row.bucket !== 'folded')
        ).filter((row) => !row.snoozed)
  const visible = listed
  const snoozedCount = queue.rows.filter((row) => row.snoozed).length
  const openTarget = route.name === 'review' ? route.target : null
  const openRow = openTarget
    ? (queue.rows.find(
        (row) =>
          row.hostId === openTarget.hostId &&
          row.project === openTarget.project &&
          row.iid === openTarget.iid,
      ) ?? null)
    : null
  // The keyboard's row: the open MR (none if it is outside the queue, so no
  // key acts on a list row while another MR is on screen), else the one
  // picked, else the first.
  const current = openTarget
    ? openRow
    : (visible.find((row) => row.key === selected) ?? visible[0] ?? null)
  // Where the open row sat in the list, so j/k carry on from there once it
  // leaves (approved, snoozed, read).
  const anchor = useRef<{ key: string; index: number } | null>(null)
  useEffect(() => {
    const index = current ? visible.indexOf(current) : -1
    if (current && index >= 0) anchor.current = { key: current.key, index }
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
  const [headerRequest, setHeaderRequest] = useState<HeaderRequest | null>(null)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  // r, x, n and m start their action in the MR header, opening the MR first.
  const askHeader = (request: HeaderRequest) => {
    if (!current) return
    if (route.name !== 'review') open(current)
    setHeaderRequest(request)
  }
  useQueueKeys(
    {
      move(delta) {
        if (!visible.length) return
        const index = current ? visible.indexOf(current) : -1
        const last = visible.length - 1
        const left = current && index < 0 && anchor.current?.key === current.key ? anchor.current : null
        const next =
          index >= 0
            ? visible[Math.min(last, Math.max(0, index + delta))]
            : left
              ? // The rows after it moved up into its place.
                visible[delta > 0 ? Math.min(left.index, last) : Math.max(left.index - 1, 0)]
              : visible[0]
        if (route.name === 'review') open(next)
        else setSelected(next.key)
      },
      open: () => current && open(current),
      diffSince: () => current && open(current, 'since'),
      // Escape and f read the address as it is now: a second key can land
      // before the screen has caught up with the first.
      close() {
        const now = parseSiteRoute(window.location.hash)
        if (now.name !== 'review') return
        window.location.hash = now.full
          ? reviewHash(now.target, { tab: now.tab, noteId: now.noteId })
          : listHash(listRoute)
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
      toggle() {},
      search() {},
      sidebar() {},
      help: () => setHelpOpen((value) => !value),
      approve: () => current && actions.approve(current),
      snooze: () => current && actions.snooze(current),
      reply: () => askHeader('reply'),
      changes: () => askHeader('changes'),
      nudge: () => askHeader('nudge'),
      moveProject: () => askHeader('move'),
    },
    route.name !== 'settings',
  )
  const me =
    (openTarget && queue.hosts.find((host) => host.hostId === openTarget.hostId)?.username) ?? ''
  const heading =
    shown.name === 'snoozed'
      ? 'Snoozed'
      : shown.name === 'project'
      ? shown.id === UNSORTED
        ? 'Unsorted'
        : (projects.find((p) => p.id === shown.id)?.name ?? 'Project')
      : shown.name === 'queue' && shown.bucket
        ? BUCKET_LABELS[shown.bucket]
        : needsYouHeading(queue.counts['needs-you'] + queue.counts['quick-wins'])

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

  // Each project link is also a drop target for a dragged row.
  const projectLink = (id: string, label: ReactNode, count: ReactNode) => (
    <a
      key={id}
      href={`#/project/${id}`}
      className="q-bucket"
      aria-current={route.name === 'project' && route.id === id ? 'page' : undefined}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const key = event.dataTransfer.getData('text/mrpr-row')
        if (key) setProjects(moveRow(projects, key, id === UNSORTED ? null : id))
      }}
    >
      <span>{label}</span>
      <span className="q-count">{count}</span>
    </a>
  )

  return (
    <div className={`q-shell${route.name === 'review' ? ' has-panel' : ''}`}>
      <aside className="q-sidebar">
        <a className="q-brand" href="#/">
          Mr. PR
        </a>
        <nav aria-label="Queue">
          <p className="q-eyebrow">Queue</p>
          {BUCKET_ORDER.filter((bucket) => bucket !== 'folded').map((bucket) => (
            <a
              key={bucket}
              href={`#/bucket/${bucket}`}
              className="q-bucket"
              aria-current={route.name === 'queue' && route.bucket === bucket ? 'page' : undefined}
            >
              <span>{BUCKET_LABELS[bucket]}</span>{' '}
              <span className="q-count">{queue.counts[bucket]}</span>
            </a>
          ))}
          <p className="q-folded">
            Folded: {queue.counts.folded} bot MR{queue.counts.folded === 1 ? '' : 's'}
          </p>
          <p className="q-folded">Today's budget: ~{todaysBudget(queue.rows)} min</p>
          {snoozedCount > 0 ? (
            <a
              href="#/snoozed"
              className="q-bucket"
              aria-current={route.name === 'snoozed' ? 'page' : undefined}
            >
              <span>Snoozed</span> <span className="q-count">{snoozedCount}</span>
            </a>
          ) : null}
        </nav>
        <nav aria-label="Projects">
          <p className="q-eyebrow">Projects</p>
          {projects.map((project) => {
            const rows = queue.rows.filter(
              (row) => row.bucket !== 'folded' && !row.snoozed && inProject(project.id)(row),
            )
            const needs = rows.filter(
              (row) => row.bucket === 'needs-you' || row.bucket === 'quick-wins',
            ).length
            return projectLink(
              project.id,
              <>
                <span className="q-dot" style={{ background: project.color }} />
                {project.name}
              </>,
              `${needs ? `${needs} / ` : ''}${rows.length}`,
            )
          })}
          {projectLink(
            UNSORTED,
            'Unsorted',
            queue.rows.filter(
              (row) => row.bucket !== 'folded' && !row.snoozed && inProject(UNSORTED)(row),
            ).length,
          )}
          {projects.length === 0 && queue.rows.length > 0 ? (
            <button
              type="button"
              className="q-sidebar-action"
              onClick={() =>
                setProjects(projectsFromRepositories(projects, queue.rows.map((row) => row.project)))
              }
            >
              Create one project per repository
            </button>
          ) : null}
          <button
            type="button"
            className="q-sidebar-action"
            onClick={() => setNewProjectOpen((open) => !open)}
          >
            + New project
          </button>
          {newProjectOpen ? <ProjectDialog onClose={() => setNewProjectOpen(false)} /> : null}
        </nav>
        <div className="q-sidebar-foot">
          <a href="#/settings">Settings</a>
          <button
            type="button"
            onClick={() => theme.setChoice(theme.theme === 'dark' ? 'light' : 'dark')}
          >
            {theme.theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>
      <main className="q-main-area">
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
        ) : (
          <div
            className={`q-split${route.name === 'review' ? ' has-panel' : ''}${
              route.name === 'review' && route.full ? ' is-full' : ''
            }`}
          >
            <div className="q-list-pane">
              {queue.isLoading ? (
                <p className="q-empty">Loading your queue…</p>
              ) : (
                <QueueList
                  rows={listed}
                  projects={projects}
                  selectedKey={current?.key ?? null}
                  onSelect={(key) => {
                    const row = visible.find((value) => value.key === key)
                    if (row) open(row)
                  }}
                  heading={heading}
                  grouped={shown.name === 'project'}
                  compact={route.name === 'review'}
                />
              )}
            </div>
            {route.name === 'review' ? (
              <MrPanel
                key={`${route.target.hostId}/${route.target.project}/${route.target.iid}`}
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
                      closeHref={listHash(listRoute)}
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
            ) : null}
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
    bucket: 'done',
    score: 0,
    badges: [],
    tags: [],
    attention: 'done',
    folded: false,
    minutes: 0,
    items: [],
    snoozed: false,
  }
}
