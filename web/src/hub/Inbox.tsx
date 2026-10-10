import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'

import type { HostConfig } from '../extension/hosts'
import type { InboxItem, InboxKind, InboxView } from '../inbox/types'
import { platform } from '../platform/platform'
import { hubRequest } from './api'
import { describeHostError } from './hostErrors'
import { relativeTime } from './relativeTime'
import { buildReviewHash } from './route'
import { SetupCard } from './SetupCard'
import { INBOX_QUERY_KEY } from './useInbox'

const VERBS: Record<InboxKind, string> = {
  reply: 'replied',
  mention: 'mentioned you',
  comment: 'commented',
  merged: 'merged',
  approved: 'approved',
  closed: 'closed',
  review_requested: 'requested your review',
}

interface MergeRequestGroup {
  key: string
  title: string
  project: string
  iid: number
  items: InboxItem[]
  unread: number
}

/** Newest activity first, both across groups and within one. */
function groupByMergeRequest(items: InboxItem[]): MergeRequestGroup[] {
  const groups = new Map<string, MergeRequestGroup>()
  for (const item of items) {
    const key = `${item.hostId}:${item.mrId}`
    const group = groups.get(key) ?? {
      key,
      title: item.mrTitle,
      project: item.project,
      iid: item.iid,
      items: [],
      unread: 0,
    }
    group.items.push(item)
    if (!item.read) group.unread += 1
    groups.set(key, group)
  }
  return [...groups.values()]
}

function InboxRow({
  item,
  onOpen,
  onRead,
}: {
  item: InboxItem
  onOpen: (item: InboxItem) => void
  onRead: (item: InboxItem) => void
}) {
  const who = item.author?.name ?? 'GitLab'
  return (
    <li className={`inbox-row${item.read ? ' is-read' : ''}`}>
      <button type="button" className="inbox-open" onClick={() => onOpen(item)}>
        {item.read ? null : <span className="unread-dot" aria-label="Unread" />}
        {item.author?.avatarUrl ? (
          <img className="inbox-avatar" src={item.author.avatarUrl} alt="" />
        ) : (
          <span className="inbox-avatar" aria-hidden="true" />
        )}
        <span className="inbox-text">
          <span className="inbox-line">
            <strong>{who}</strong> <span>{VERBS[item.kind]}</span>
          </span>
          {item.excerpt ? (
            <span className="inbox-excerpt">{item.excerpt}</span>
          ) : null}
        </span>
        <time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
      </button>
      <a
        className="inbox-gitlab"
        href={item.webUrl}
        target="_blank"
        rel="noreferrer"
        onClick={() => onRead(item)}
      >
        GitLab <span aria-hidden="true">↗</span>
      </a>
    </li>
  )
}

export function Inbox({ inbox }: { inbox: UseQueryResult<InboxView, Error> }) {
  const queryClient = useQueryClient()
  const hosts = useQuery({
    queryKey: ['hosts'],
    queryFn: () => hubRequest<HostConfig[]>('listHosts'),
  })
  const refresh = useMutation({
    mutationFn: () => hubRequest<InboxView>('pollNow'),
    onSuccess: (value) => queryClient.setQueryData(INBOX_QUERY_KEY, value),
  })
  const markAll = useMutation({
    mutationFn: () => hubRequest<null>('markAllRead'),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY }),
  })

  async function markRead(item: InboxItem) {
    if (item.read) return
    await hubRequest<null>('markRead', { ids: [item.id] }).catch(() => undefined)
    void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
  }

  async function open(item: InboxItem) {
    await markRead(item)
    window.location.hash = buildReviewHash(
      { hostId: item.hostId, project: item.project, iid: item.iid },
      item.noteId,
    )
  }

  if (hosts.isLoading || inbox.isLoading) return <p>Loading…</p>
  if (hosts.isSuccess && hosts.data.length === 0) return <SetupCard />
  if (inbox.isError || !inbox.data) {
    return (
      <p className="hub-error" role="alert">
        Could not load your inbox. Delta’s background service did not answer;
        retry, and reload this page if it keeps failing.{' '}
        <button type="button" onClick={() => void inbox.refetch()}>
          Retry
        </button>
        {inbox.error ? (
          <span className="hub-detail">{inbox.error.message}</span>
        ) : null}
      </p>
    )
  }

  const view = inbox.data
  const groups = groupByMergeRequest(view.items)
  const neverPolled = view.hosts.every(
    (host) => host.lastPollAt === null && host.error === null,
  )

  return (
    <>
      <div className="inbox-toolbar">
        <h2>Inbox</h2>
        <button
          type="button"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? 'Checking…' : 'Refresh'}
        </button>
        <button
          type="button"
          disabled={view.unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all read
        </button>
      </div>
      {view.hosts
        .filter((host) => host.error)
        .map((host) => (
          <p key={host.hostId} className="hub-error">
            {host.host}: {describeHostError(host.error!.code)}{' '}
            {!platform().needsToken &&
            (host.error!.code === 'signed_out' ||
              host.error!.code === 'gitlab_authentication_failed') ? (
              <button
                type="button"
                onClick={() =>
                  void platform().connectHost({
                    host: host.host,
                    apiBase: `https://${host.host}/api/v4`,
                  })
                }
              >
                Sign in again
              </button>
            ) : (
              <a href="#/settings">Open settings</a>
            )}
            <span className="hub-detail">{host.error!.message}</span>
          </p>
        ))}
      {neverPolled ? (
        <p className="hub-note" aria-live="polite">
          Checking GitLab for activity…
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p className="hub-empty">
          Nothing needs you. Replies, mentions and comments on your merge
          requests show up here.
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            className="inbox-group"
            aria-label={`${group.title}, ${group.unread} unread`}
          >
            <header className="inbox-group-heading">
              {group.unread > 0 ? (
                <span className="unread-dot" aria-hidden="true" />
              ) : null}
              <strong>{group.title}</strong>
              <span className="hub-row-meta">
                {group.project}!{group.iid}
              </span>
              {group.unread > 0 ? (
                <span className="thread-count">{group.unread}</span>
              ) : null}
            </header>
            <ul className="hub-list">
              {group.items.map((value) => (
                <InboxRow
                  key={value.id}
                  item={value}
                  onOpen={(target) => void open(target)}
                  onRead={(target) => void markRead(target)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  )
}
