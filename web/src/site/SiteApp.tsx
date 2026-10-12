import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import type { HostConfig } from '../extension/hosts'
import { Hub } from '../hub/Hub'
import { hubRequest } from '../hub/api'
import { lockedPoll, startPageSchedule } from '../inbox/pageSchedule'
import { platform } from '../platform/platform'
import { signIn } from './auth'
import { siteConfig, type SiteConfig, type SiteHost } from './config'
import { EXAMPLE_MR_URL, parseServer, type Server } from './server'
import { rememberHost, resolveServer, adoptSite } from './servers'
import { SetupView } from './SetupView'

function SignedIn() {
  useEffect(() => startPageSchedule({ poll: lockedPoll }), [])
  return <Hub />
}

/** The mark from the landing page: a ruled page with the margin line. */
function Mark() {
  return (
    <svg width="40" height="40" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="1" y="1" width="28" height="28" rx="7" fill="#12161F" />
      <line x1="9.5" y1="6" x2="9.5" y2="24" stroke="#C2410C" strokeWidth="2.2" />
      <line x1="14" y1="11" x2="23" y2="11" stroke="#F4F4F0" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="14" y1="15.5" x2="21" y2="15.5" stroke="#F4F4F0" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="14" y1="20" x2="19" y2="20" stroke="#F4F4F0" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

type View = 'signin' | { setup: Server; replacing?: string }

const returnTo = () => window.location.hash || '#/'

function SignIn({ config, notice }: { config: SiteConfig; notice: string | null }) {
  const [view, setView] = useState<View>('signin')
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Servers built into this deployment can't be set up again from here.
  const builtIn = new Set(siteConfig().hosts.map((value) => value.host))

  async function go(site: SiteHost) {
    adoptSite(config, site)
    await rememberHost(platform().store, site)
    await signIn(site, returnTo(), config.scopes)
  }

  async function continueWith(event: FormEvent) {
    event.preventDefault()
    const parsed = parseServer(link)
    if (!parsed.ok) {
      setLinkError(parsed.message)
      return
    }
    setLinkError(null)
    setBusy(true)
    try {
      const resolved = await resolveServer(parsed.server, config)
      if (resolved) await go(resolved.site)
      else setView({ setup: parsed.server })
    } finally {
      setBusy(false)
    }
  }

  if (view !== 'signin') {
    return (
      <SetupView
        server={view.setup}
        replacing={view.replacing}
        onBack={() => setView('signin')}
      />
    )
  }

  return (
    <main className="signin">
      <div className="signin-card">
        <h1 className="signin-brand">
          <Mark />
          <span>Mr. PR</span>
        </h1>
        <p className="signin-headline">
          Every merge request waiting, in one inbox.
        </p>
        {notice ? (
          <p className="signin-notice" role="alert">
            {notice}
          </p>
        ) : null}
        <form className="signin-link" onSubmit={(event) => void continueWith(event)}>
          <label htmlFor="mr-link">Paste a link to any merge request</label>
          <div className="signin-link-row">
            <input
              id="mr-link"
              value={link}
              placeholder={EXAMPLE_MR_URL}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setLink(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </div>
          {linkError ? (
            <p className="signin-notice" role="alert">
              {linkError}
            </p>
          ) : null}
        </form>
        {config.hosts.length > 0 ? (
          <div className="signin-actions">
            {config.hosts.map((site) => (
              <div key={site.host} className="signin-actions">
                <button
                  className="signin-button"
                  type="button"
                  onClick={() => void signIn(site, returnTo(), config.scopes)}
                >
                  <span className="signin-button-label">Sign in with GitLab</span>
                  <span className="signin-button-host">{site.host}</span>
                </button>
                {builtIn.has(site.host) ? null : (
                  <button
                    className="signin-again"
                    type="button"
                    onClick={() =>
                      setView({
                        setup: { host: site.host, origin: `https://${site.host}` },
                        replacing: site.clientId,
                      })
                    }
                  >
                    Sign-in not working? Set it up again
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}
        <p className="signin-privacy">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>
            Your browser talks to GitLab directly. This site never sees your
            token or your merge requests.
          </span>
        </p>
      </div>
      <a className="signin-home" href="../">
        ← Back to Mr. PR
      </a>
    </main>
  )
}

export function SiteApp({ config, notice }: { config: SiteConfig; notice: string | null }) {
  const hosts = useQuery({
    queryKey: ['hosts'],
    queryFn: () => hubRequest<HostConfig[]>('listHosts'),
  })

  if (hosts.isLoading) return <p>Loading…</p>
  if (!hosts.data?.length) return <SignIn config={config} notice={notice} />
  return <SignedIn />
}
