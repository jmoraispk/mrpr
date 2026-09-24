import { useEffect, useState } from 'react'

import App from '../App'
import { DevReload } from '../extension/devReload'
import { ACTIVE_POLL_MAX_AGE_MS } from '../inbox/types'
import { TransportProvider } from '../transport/context'
import { createRuntimeTransport } from '../transport/runtime'
import { hubRequest } from './api'
import { Inbox } from './Inbox'
import { Lists } from './Lists'
import { parseRoute, type Route } from './route'
import { Settings } from './Settings'
import { useInbox, useUnreadTitle } from './useInbox'

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.hash),
  )
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

export function Hub() {
  const route = useRoute()
  const inbox = useInbox()
  const unread = inbox.data?.unread ?? 0
  useUnreadTitle(unread)

  // Opening the hub is a sign the user is looking; catch up if the alarm's
  // last poll is stale rather than waiting up to two minutes for the next.
  useEffect(() => {
    void hubRequest('pollNow', { maxAgeMs: ACTIVE_POLL_MAX_AGE_MS }).catch(
      () => undefined,
    )
  }, [])

  if (route.name === 'review') {
    return (
      <TransportProvider
        key={`${route.target.hostId}/${route.target.project}/${route.target.iid}`}
        transport={createRuntimeTransport(route.target)}
      >
        <App focusNoteId={route.noteId} />
      </TransportProvider>
    )
  }

  const current = (name: Route['name']) =>
    route.name === name ? ('page' as const) : undefined

  // The same shell the review view renders into, so both surfaces read as one
  // application: `.app-shell` supplies the topbar row and pins the rest of the
  // window for `.hub` to scroll inside.
  return (
    <div className="app-shell">
      <header className="topbar topbar-hub">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true" />
          <span>delta</span>
        </a>
        <nav className="topbar-meta">
          <DevReload />
          <a href="#/" aria-current={current('inbox')}>
            Inbox
            {unread > 0 ? <span className="nav-count">{unread}</span> : null}
          </a>
          <a href="#/merge-requests" aria-current={current('mergeRequests')}>
            Merge requests
          </a>
          <a href="#/settings" aria-current={current('settings')}>
            Settings
          </a>
        </nav>
      </header>

      <main className="hub">
        <div className="hub-column">
          {route.name === 'settings' ? (
            <Settings />
          ) : route.name === 'mergeRequests' ? (
            <Lists />
          ) : (
            <Inbox inbox={inbox} />
          )}
        </div>
      </main>
    </div>
  )
}
