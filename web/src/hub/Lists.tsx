import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import browser from 'webextension-polyfill'

import type { HostConfig } from '../extension/hosts'
import { originFor } from '../extension/hosts'
import type {
  MergeRequestPage,
  MergeRequestSummary,
} from '../gitlab/mergeRequests'
import { hubRequest, type HostSummary } from './api'
import { parseMergeRequestUrl } from './mrUrl'
import { describeHostError } from './hostErrors'
import { buildReviewHash } from './route'
import { SetupCard } from './SetupCard'
import { mergeRequestKey } from './useInbox'

/**
 * Where the hub remembers which repository groups the user folded away.
 *
 * This page already holds the `storage` permission and a collapsed group is
 * throwaway view state, so it reads and writes `browser.storage.local` itself
 * instead of paying a message round trip to the worker. It touches this key
 * and nothing else: `hosts` and `tokens` belong to the worker (see
 * `extension/hosts.ts`), and a personal access token must never be reachable
 * from a page context. `storage.local.set` merges by key, so writing here
 * cannot disturb either of those.
 */
const COLLAPSED_KEY = 'hubCollapsedGroups'

/**
 * Collapsed repository paths, per host id. Keying by host as well as path
 * matters: `group/api` on two GitLab instances are two different repositories
 * that happen to share a name. A missing host, or a path missing from its
 * list, means the group is open — which is also what a first visit gets.
 */
type CollapsedGroups = Record<string, string[]>

function isGroupCollapsed(
  state: CollapsedGroups,
  hostId: string,
  repository: string,
): boolean {
  return state[hostId]?.includes(repository) ?? false
}

function withGroupToggled(
  state: CollapsedGroups,
  hostId: string,
  repository: string,
): CollapsedGroups {
  const current = state[hostId] ?? []
  const next = current.includes(repository)
    ? current.filter((path) => path !== repository)
    : [...current, repository]
  const result = { ...state }
  // Dropping emptied hosts keeps the stored object from growing a permanent
  // entry for every host the user ever collapsed a group on and then reopened.
  if (next.length === 0) delete result[hostId]
  else result[hostId] = next
  return result
}

function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<CollapsedGroups>({})
  // `toggle` reads the newest value through this rather than through its own
  // closure, so two clicks in the same tick cannot make the second one undo
  // the first by starting from a stale copy.
  const latest = useRef<CollapsedGroups>(collapsed)

  useEffect(() => {
    let live = true
    void browser.storage.local.get(COLLAPSED_KEY).then((stored) => {
      const value = stored[COLLAPSED_KEY]
      if (!live || !value || typeof value !== 'object') return
      latest.current = value as CollapsedGroups
      setCollapsed(latest.current)
    })
    return () => {
      live = false
    }
  }, [])

  const toggle = useCallback((hostId: string, repository: string) => {
    const next = withGroupToggled(latest.current, hostId, repository)
    latest.current = next
    setCollapsed(next)
    void browser.storage.local.set({ [COLLAPSED_KEY]: next })
  }, [])

  return { collapsed, toggle }
}

interface RepositoryGroup {
  repository: string
  items: MergeRequestSummary[]
}

/**
 * The repository a merge request belongs to. A `references.full` of
 * `gputelecom/aerial_sdk!5606` names merge request 5606 of
 * `gputelecom/aerial_sdk`, so everything before the `!` is the path — the same
 * split `MergeRequestRow` uses to build a review target.
 */
function repositoryOf(item: MergeRequestSummary): string {
  return item.references.full.split('!')[0]
}

function updatedAt(item: MergeRequestSummary): number {
  const parsed = Date.parse(item.updated_at)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * One group per repository: newest merge request first within a group, and the
 * group holding the newest merge request first overall, so the repository that
 * moved most recently sits at the top of the section.
 */
function groupByRepository(items: MergeRequestSummary[]): RepositoryGroup[] {
  const groups = new Map<string, MergeRequestSummary[]>()
  for (const item of items) {
    const repository = repositoryOf(item)
    const existing = groups.get(repository)
    if (existing) existing.push(item)
    else groups.set(repository, [item])
  }
  return [...groups]
    .map(([repository, group]) => ({
      repository,
      items: group.sort((a, b) => updatedAt(b) - updatedAt(a)),
    }))
    .sort((a, b) => updatedAt(b.items[0]) - updatedAt(a.items[0]))
}

function MergeRequestRow({
  hostId,
  item,
  unread,
}: {
  hostId: string
  item: MergeRequestSummary
  unread: boolean
}) {
  const target = {
    hostId,
    project: item.references.full.split('!')[0],
    iid: item.iid,
  }
  return (
    <li className="hub-row">
      <a href={buildReviewHash(target)}>
        <strong>
          {unread ? (
            <span className="unread-dot" aria-label="Unread activity" />
          ) : null}
          {item.title}
        </strong>
        <span className="hub-row-meta">
          {item.references.full} · {item.author.name}
        </span>
      </a>
    </li>
  )
}

/**
 * One repository inside a section: a heading that folds the rows away, and the
 * rows themselves.
 *
 * The heading is a real `<button>` carrying `aria-expanded` rather than a
 * clickable `<div>`, so it keeps its place in the tab order the merge request
 * links already occupy. The count is shown whether the group is open or shut —
 * a badge that only appears once you collapse a group is a control that
 * changes shape as you use it, and the size of a repository's queue is worth
 * knowing either way.
 */
function Group({
  hostId,
  group,
  collapsed,
  unread,
  onToggle,
}: {
  hostId: string
  group: RepositoryGroup
  collapsed: boolean
  unread: Set<string>
  onToggle: () => void
}) {
  const count = group.items.length
  return (
    <div className="hub-group">
      <button
        type="button"
        className="hub-group-toggle"
        aria-expanded={!collapsed}
        aria-label={`${group.repository}, ${count} merge request${
          count === 1 ? '' : 's'
        }`}
        onClick={onToggle}
      >
        <span className="hub-group-caret" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        <span className="hub-group-name">{group.repository}</span>
        <span className="thread-count">{count}</span>
      </button>
      {collapsed ? null : (
        <ul className="hub-list">
          {group.items.map((item) => (
            <MergeRequestRow
              key={item.id}
              hostId={hostId}
              item={item}
              unread={unread.has(
                mergeRequestKey(hostId, repositoryOf(item), item.iid),
              )}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Section({
  title,
  hostId,
  page,
  collapsed,
  unread,
  onToggle,
}: {
  title: string
  hostId: string
  page: MergeRequestPage
  collapsed: CollapsedGroups
  unread: Set<string>
  onToggle: (hostId: string, repository: string) => void
}) {
  const groups = groupByRepository(page.items)
  return (
    <section className="hub-section">
      <h3 className="eyebrow">{title}</h3>
      {groups.length === 0 ? (
        <p className="hub-empty">Nothing here.</p>
      ) : (
        groups.map((group) => (
          <Group
            key={group.repository}
            hostId={hostId}
            group={group}
            collapsed={isGroupCollapsed(collapsed, hostId, group.repository)}
            unread={unread}
            onToggle={() => onToggle(hostId, group.repository)}
          />
        ))
      )}
      {page.truncated ? (
        <p className="hub-note">
          Showing the first 100. Open GitLab to see the rest.
        </p>
      ) : null}
    </section>
  )
}

function OpenByUrl({ hosts }: { hosts: HostConfig[] }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function open() {
    const target = parseMergeRequestUrl(value.trim(), hosts)
    if (!target) {
      setError(
        'That is not a merge request URL for a GitLab host you have added.',
      )
      return
    }
    setError(null)
    window.location.hash = buildReviewHash(target)
  }

  return (
    <section className="hub-section">
      <h3 className="eyebrow">Open by URL</h3>
      <div className="hub-open">
        <input
          type="url"
          value={value}
          placeholder="https://gitlab.example.com/group/project/-/merge_requests/42"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') open()
          }}
        />
        <button type="button" onClick={open}>
          Open
        </button>
      </div>
      {error ? (
        <p className="hub-error">
          {error} <a href="#/settings">Add a GitLab host</a>
        </p>
      ) : null}
    </section>
  )
}

export function Lists({
  unread = new Set<string>(),
}: { unread?: Set<string> } = {}) {
  const queryClient = useQueryClient()
  const hosts = useQuery({
    queryKey: ['hosts'],
    queryFn: () => hubRequest<HostConfig[]>('listHosts'),
  })
  const summaries = useQuery({
    queryKey: ['merge-requests'],
    queryFn: () => hubRequest<HostSummary[]>('listMergeRequests'),
    enabled: (hosts.data?.length ?? 0) > 0,
  })
  const groups = useCollapsedGroups()

  async function grant(host: string) {
    const granted = await browser.permissions.request({
      origins: [originFor(host)],
    })
    if (granted) {
      void queryClient.invalidateQueries({ queryKey: ['merge-requests'] })
    }
  }

  if (hosts.isLoading) return <p>Loading…</p>
  // A rejected `listHosts` leaves `hosts.data` undefined, which the check
  // below cannot tell apart from a genuinely empty list. Without this branch
  // first, a user with hosts configured lands on the setup card and is told to
  // add their first GitLab host — the one screen that is certainly wrong, on
  // the page they see first.
  if (hosts.isError) {
    return (
      <p className="hub-error" role="alert">
        Could not load your GitLab hosts. Delta’s background service did not
        answer, so this is not a sign that your hosts are gone; retry, and
        reload this page if it keeps failing.{' '}
        <button type="button" onClick={() => void hosts.refetch()}>
          Retry
        </button>
        <span className="hub-detail">{hosts.error.message}</span>
      </p>
    )
  }
  if (!hosts.data?.length) {
    return <SetupCard />
  }

  return (
    <>
      <OpenByUrl hosts={hosts.data} />
      {/*
        A rejected `listMergeRequests` is a different situation from the
        per-host errors below: the worker never got far enough to report on any
        host. Without this branch `summaries.data` stays undefined and the page
        renders the box above and nothing else — no message, no retry, no sign
        anything failed.
      */}
      {summaries.isLoading ? (
        <p className="hub-note" aria-live="polite">
          Loading merge requests…
        </p>
      ) : null}
      {summaries.isError ? (
        <p className="hub-error" role="alert">
          Could not load your merge requests. Delta’s background service did
          not answer; retry, and reload this page if it keeps failing.{' '}
          <button type="button" onClick={() => void summaries.refetch()}>
            Retry
          </button>
          <span className="hub-detail">{summaries.error.message}</span>
        </p>
      ) : null}
      {summaries.data?.map((summary) => (
        <div key={summary.hostId}>
          <h2>{summary.host ?? summary.hostId}</h2>
          {summary.error === 'permission_missing' ? (
            <p className="hub-error">
              Delta no longer has permission to reach{' '}
              {summary.host ?? summary.hostId}.{' '}
              <button type="button" onClick={() => grant(summary.host!)}>
                Grant access
              </button>
            </p>
          ) : summary.error ? (
            <p className="hub-error">
              {describeHostError(summary.error)}{' '}
              <a href="#/settings">
                Reconnect {summary.host ?? summary.hostId}
              </a>
              <span className="hub-detail">{summary.error}</span>
            </p>
          ) : (
            <>
              <Section
                title="Awaiting your review"
                hostId={summary.hostId}
                page={summary.reviewing!}
                collapsed={groups.collapsed}
                unread={unread}
                onToggle={groups.toggle}
              />
              <Section
                title="Yours"
                hostId={summary.hostId}
                page={summary.authored!}
                collapsed={groups.collapsed}
                unread={unread}
                onToggle={groups.toggle}
              />
            </>
          )}
        </div>
      ))}
    </>
  )
}
