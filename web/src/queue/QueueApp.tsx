import { useEffect, useState, type ReactNode } from 'react'

import App from '../App'
import { hubRequest } from '../hub/api'
import { describeHostError } from '../hub/hostErrors'
import { Settings } from '../hub/Settings'
import { useUnreadTitle } from '../hub/useInbox'
import { ACTIVE_POLL_MAX_AGE_MS } from '../inbox/types'
import { platform } from '../platform/platform'
import { TransportProvider } from '../transport/context'
import { createRuntimeTransport } from '../transport/runtime'
import { KeyHelp } from './KeyHelp'
import { BUCKET_LABELS, BUCKET_ORDER, todaysBudget, type QueueRow } from './model'
import { ProjectDialog } from './ProjectDialog'
import { moveRow, projectOf, projectsFromRepositories } from './projects'
import { ProjectsSettings } from './ProjectsSettings'
import { QueueList } from './QueueList'
import { focusNoteOf, markRowRead } from './readState'
import { RowDrawer, type DrawerRequest } from './RowDrawer'
import { parseSiteRoute, reviewHash, type SiteRoute } from './route'
import { useProjects } from './state'
import { useTheme } from './theme'
import { useQueue } from './useQueue'
import { useQueueKeys } from './useQueueKeys'

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
  const [drawerClosed, setDrawerClosed] = useState(false)
  const [request, setRequest] = useState<DrawerRequest | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  useUnreadTitle(queue.counts['needs-you'] + queue.counts['quick-wins'])
  // Opening the queue is a sign the user is looking; catch up if the last
  // poll is stale rather than waiting up to two minutes for the next.
  useEffect(() => {
    void hubRequest('pollNow', { maxAgeMs: ACTIVE_POLL_MAX_AGE_MS }).catch(() => undefined)
  }, [])

  const inProject = (id: string) => (row: QueueRow) =>
    id === UNSORTED ? projectOf(row, projects) === null : projectOf(row, projects)?.id === id
  // A project's view keeps Waiting and Done too, so nothing in it is forgotten.
  const listed =
    route.name === 'project'
      ? queue.rows.filter((row) => row.bucket !== 'folded' && inProject(route.id)(row))
      : route.name === 'queue' && route.bucket
        ? queue.rows.filter((row) => row.bucket === route.bucket)
        : queue.rows.filter((row) => row.bucket !== 'done' && row.bucket !== 'folded')
  const visible = listed.filter((row) => !row.snoozed)
  // The keyboard always has a row: the one picked, else the first.
  const current = visible.find((row) => row.key === selected) ?? visible[0] ?? null
  const select = (key: string) => {
    setSelected(key)
    setDrawerClosed(false)
  }
  const ask = (next: DrawerRequest) => {
    // With no row, a request would linger and fire on the next drawer.
    if (!current) return
    setDrawerClosed(false)
    setRequest(next)
  }
  const openReview = (since: boolean) => {
    if (!current) return
    markRowRead(current)
    window.location.hash = reviewHash(
      { hostId: current.hostId, project: current.project, iid: current.iid },
      { since, noteId: since ? null : focusNoteOf(current) },
    )
  }
  useQueueKeys(
    {
      move(delta) {
        if (!visible.length) return
        const index = current ? visible.indexOf(current) : -1
        select(visible[Math.min(visible.length - 1, Math.max(0, index + delta))].key)
      },
      open: () => openReview(false),
      diffSince: () => openReview(true),
      jump(bucket) {
        window.location.hash = `#/bucket/${bucket}`
      },
      jumpProject() {
        document.querySelector<HTMLElement>('nav[aria-label="Projects"] a')?.focus()
      },
      help: () => setHelpOpen((open) => !open),
      approve: () => ask('approve'),
      reply: () => ask('reply'),
      changes: () => ask('changes'),
      nudge: () => ask('nudge'),
      snooze: () => ask('snooze'),
      moveProject: () => ask('move'),
    },
    route.name !== 'review' && route.name !== 'settings',
  )

  if (route.name === 'review') {
    return (
      <TransportProvider
        key={`${route.target.hostId}/${route.target.project}/${route.target.iid}`}
        transport={createRuntimeTransport(route.target)}
      >
        <App focusNoteId={route.noteId} startSince={route.since} />
      </TransportProvider>
    )
  }
  const heading =
    route.name === 'project'
      ? route.id === UNSORTED
        ? 'Unsorted'
        : (projects.find((p) => p.id === route.id)?.name ?? 'Project')
      : route.name === 'queue' && route.bucket
        ? BUCKET_LABELS[route.bucket]
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
    <div className="q-shell">
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
        </nav>
        <nav aria-label="Projects">
          <p className="q-eyebrow">Projects</p>
          {projects.map((project) => {
            const rows = queue.rows.filter((row) => row.bucket !== 'folded' && inProject(project.id)(row))
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
            queue.rows.filter((row) => row.bucket !== 'folded' && inProject(UNSORTED)(row)).length,
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
        ) : queue.isLoading ? (
          <p className="q-empty">Loading your queue…</p>
        ) : (
          <div className="q-with-drawer">
            <QueueList
              rows={listed}
              projects={projects}
              selectedKey={current?.key ?? null}
              onSelect={select}
              heading={heading}
              grouped={route.name === 'project'}
            />
            {current && !drawerClosed ? (
              <RowDrawer
                key={current.key}
                row={current}
                onClose={() => setDrawerClosed(true)}
                onOpen={() => markRowRead(current)}
                request={request}
                onRequestHandled={() => setRequest(null)}
              />
            ) : null}
          </div>
        )}
      </main>
      <KeyHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
