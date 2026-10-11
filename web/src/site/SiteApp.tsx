import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { HostConfig } from '../extension/hosts'
import { Hub } from '../hub/Hub'
import { hubRequest } from '../hub/api'
import { lockedPoll, startPageSchedule } from '../inbox/pageSchedule'
import { platform } from '../platform/platform'
import type { SiteConfig } from './config'

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

function SignIn({ config, notice }: { config: SiteConfig; notice: string | null }) {
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
        <div className="signin-actions">
          {config.hosts.map((site) => (
            <button
              key={site.host}
              className="signin-button"
              type="button"
              onClick={() =>
                void platform().connectHost({
                  host: site.host,
                  apiBase: `https://${site.host}/api/v4`,
                })
              }
            >
              <span className="signin-button-label">Sign in with GitLab</span>
              <span className="signin-button-host">{site.host}</span>
            </button>
          ))}
        </div>
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
    enabled: config.hosts.length > 0,
  })

  if (config.hosts.length === 0) {
    return (
      <div className="state-screen">
        <h1>Mr. PR is not set up to sign in</h1>
        <p>
          This build has no GitLab application id. See{' '}
          <code>docs/site-setup.md</code> in the repository.
        </p>
      </div>
    )
  }
  if (hosts.isLoading) return <p>Loading…</p>
  if (!hosts.data?.length) return <SignIn config={config} notice={notice} />
  return <SignedIn />
}
