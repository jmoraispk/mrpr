import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { HostConfig } from '../core/hosts'
import { INBOX_SETTINGS_KEY, loadSettings } from '../inbox/store'
import type { InboxSettings } from '../inbox/types'
import { platform } from '../platform/platform'
import { hubRequest } from './api'

/**
 * Turns what a user is likely to paste into a bare hostname, or throws with
 * copy explaining why it cannot be stored.
 *
 * A port is rejected rather than quietly dropped. `parseMergeRequestUrl`
 * derives a host id from `new URL(...).hostname`, which never carries a port,
 * so a host saved as `gitlab.example.com:8443` would have an id no merge
 * request URL could ever match — the host would look configured and every
 * link would still be refused. `https://host:port/*` is not a valid extension
 * match pattern either, so the permission request would fail as well.
 */
function cleanHostname(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  if (!cleaned) throw new Error('Enter a GitLab hostname')
  if (cleaned.includes(':')) {
    throw new Error(
      `Enter the hostname without a port — "${cleaned.split(':')[0]}". ` +
        'Mr. PR matches merge request URLs by hostname alone, so a host with ' +
        'a port could never match one.',
    )
  }
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(cleaned)) {
    throw new Error(
      `"${cleaned}" is not a hostname. Enter something like gitlab.example.com.`,
    )
  }
  return cleaned
}

/**
 * Inbox preferences. Like `hubCollapsedGroups`, this is a page-owned key: the
 * page writes it directly and the worker only reads it, at the next poll.
 */
function InboxPreferences() {
  const [settings, setSettings] = useState<InboxSettings | null>(null)
  useEffect(() => {
    let live = true
    void loadSettings().then((value) => {
      if (live) setSettings(value)
    })
    return () => {
      live = false
    }
  }, [])
  if (!settings) return null
  return (
    <section className="hub-section">
      <h3 className="eyebrow">Inbox</h3>
      <label className="hub-check">
        <input
          type="checkbox"
          checked={settings.hideBots}
          onChange={(event) => {
            const next = { ...settings, hideBots: event.target.checked }
            setSettings(next)
            void platform().store.set({ [INBOX_SETTINGS_KEY]: next })
          }}
        />{' '}
        Hide comments from bots
      </label>
      <p className="hub-note">
        Automated reviewers post a lot. This applies to activity found from now
        on.
      </p>
    </section>
  )
}

export function Settings() {
  const site = platform()
  const queryClient = useQueryClient()
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  const hosts = useQuery({
    queryKey: ['hosts'],
    queryFn: () => hubRequest<HostConfig[]>('listHosts'),
  })

  // A host permission can be withdrawn from browser settings at any time, and
  // `browser.permissions.request` only works from a user gesture on a page —
  // never from the service worker. This page is where that gesture has to
  // happen, so it has to know which hosts are missing one. The host ids are in
  // the key so adding or removing a host re-reads the permissions.
  const permitted = useQuery({
    queryKey: [
      'host-permissions',
      (hosts.data ?? []).map((value) => value.id).join(','),
    ],
    queryFn: async () => {
      const entries = await Promise.all(
        (hosts.data ?? []).map(
          async (value) =>
            [
              value.id,
              await site.hasHostAccess!(value.host),
            ] as const,
        ),
      )
      return Object.fromEntries(entries)
    },
    enabled: (hosts.data?.length ?? 0) > 0 && site.hasHostAccess !== undefined,
  })

  async function grant(value: HostConfig) {
    await site.requestHostAccess?.(value.host)
    void queryClient.invalidateQueries({ queryKey: ['host-permissions'] })
    void queryClient.invalidateQueries({ queryKey: ['merge-requests'] })
  }

  const add = useMutation({
    mutationFn: async () => {
      const cleaned = cleanHostname(host)
      const granted = (await site.requestHostAccess?.(cleaned)) ?? true
      if (!granted) {
        throw new Error(
          `Mr. PR needs permission to reach ${cleaned} before it can use your token.`,
        )
      }
      return hubRequest<HostConfig>('addHost', {
        host: cleaned,
        apiBase: `https://${cleaned}/api/v4`,
        token: token.trim(),
      })
    },
    onSuccess: () => {
      setHost('')
      setToken('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['hosts'] })
      void queryClient.invalidateQueries({ queryKey: ['merge-requests'] })
    },
    onError: (value: Error) => setError(value.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => hubRequest<null>('removeHost', { id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hosts'] })
      void queryClient.invalidateQueries({ queryKey: ['merge-requests'] })
    },
  })

  return (
    <div className="hub-settings">
      <h2>GitLab hosts</h2>
      <ul className="hub-list">
        {hosts.data?.map((value) => (
          <li key={value.id} className="hub-row">
            <span>
              <strong>{value.host}</strong>
              <span className="hub-row-meta">signed in as {value.username}</span>
            </span>
            <span>
              {permitted.data?.[value.id] === false ? (
                <button type="button" onClick={() => void grant(value)}>
                  Grant access
                </button>
              ) : null}{' '}
              <button type="button" onClick={() => remove.mutate(value.id)}>
                {site.needsToken ? 'Remove' : 'Sign out'}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {site.needsToken ? (
        <>
          <h3 className="eyebrow">Add a host</h3>
          <p className="hub-note">
            Create a personal access token with the <code>api</code> scope. Give it
            an expiry date — Mr. PR stores it in extension storage on this machine.
          </p>
          <label className="eyebrow">
            Hostname
            <input
              type="text"
              placeholder="gitlab.example.com"
              value={host}
              onChange={(event) => setHost(event.target.value)}
            />
          </label>
          <label className="eyebrow">
            Personal access token
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button
            className="primary-action"
            type="button"
            disabled={add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? 'Checking…' : 'Add host'}
          </button>
          {error ? <p className="hub-error">{error}</p> : null}
        </>
      ) : null}
      <InboxPreferences />
    </div>
  )
}
