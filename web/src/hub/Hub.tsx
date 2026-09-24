import { useEffect, useState } from 'react'

import App from '../App'
import { DevReload } from '../extension/devReload'
import { TransportProvider } from '../transport/context'
import { createRuntimeTransport } from '../transport/runtime'
import { Lists } from './Lists'
import { parseRoute, type Route } from './route'
import { Settings } from './Settings'

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
          <a href="#/settings">Settings</a>
        </nav>
      </header>

      <main className="hub">
        <div className="hub-column">
          {route.name === 'settings' ? <Settings /> : <Lists />}
        </div>
      </main>
    </div>
  )
}
