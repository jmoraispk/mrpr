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

function SignIn({ config, notice }: { config: SiteConfig; notice: string | null }) {
  return (
    <div className="state-screen">
      <h1>Mr. PR</h1>
      <p>Your GitLab inbox and merge request reviews, in one place.</p>
      {notice ? (
        <p className="hub-error" role="alert">
          {notice}
        </p>
      ) : null}
      {config.hosts.map((site) => (
        <button
          key={site.host}
          className="primary-action"
          type="button"
          onClick={() =>
            void platform().connectHost({
              host: site.host,
              apiBase: `https://${site.host}/api/v4`,
            })
          }
        >
          Sign in to {site.host}
        </button>
      ))}
      <p className="hub-note">
        Your browser talks to GitLab directly. This site never sees your
        token or your merge requests.
      </p>
    </div>
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
