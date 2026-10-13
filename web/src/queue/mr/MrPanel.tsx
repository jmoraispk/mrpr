import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import App from '../../App'
import type { MrOverview } from '../../gitlab/mrOverview'
import { TransportProvider } from '../../transport/context'
import { createRuntimeTransport } from '../../transport/runtime'
import type { ReviewTarget } from '../../transport/types'
import { lookKeyFor, type QueueRow } from '../model'
import { reviewHash, type ReviewTab } from '../route'
import { readStored } from '../state'

/** Your last look at an MR, as stored. */
export type Look = { headSha: string; at: string } | null

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The MR beside the queue: header, tabs, and Overview or the code. */
export function MrPanel({
  target,
  row,
  tab,
  full,
  noteId,
  header,
  overview: renderOverview,
}: {
  target: ReviewTarget
  row: QueueRow | null
  me: string
  tab: ReviewTab
  full: boolean
  noteId: number | null
  header: (overview: MrOverview | undefined, previous: Look) => ReactNode
  overview: (overview: MrOverview, previous: Look) => ReactNode
}) {
  const transport = useMemo(() => createRuntimeTransport(target), [target])
  const key = `${target.hostId}/${target.project}/${target.iid}`
  const lookKey = lookKeyFor(target.hostId, target.project, target.iid)
  const overview = useQuery({
    queryKey: ['overview', key],
    queryFn: () => transport.getOverview!(),
    staleTime: 30_000,
  })
  // The look before this visit, read once as the panel opens for this MR.
  const previous = useQuery({
    queryKey: ['previous-look', lookKey],
    queryFn: async () =>
      (await readStored<Record<string, { headSha: string; at: string }>>('lastLook'))?.[lookKey] ??
      null,
    staleTime: Infinity,
    refetchOnMount: 'always',
  })
  const headSha = overview.data?.headSha ?? null
  // Opening the panel is a look at this head, written only after the
  // previous look was read, so "since" keeps meaning "before this visit".
  const looked = useRef<string | null>(null)
  useEffect(() => {
    if (!headSha || !previous.isFetchedAfterMount || looked.current === key) return
    looked.current = key
    void transport.markLooked?.(headSha)
  }, [headSha, previous.isFetchedAfterMount, key, transport])

  const prior = previous.data ?? null
  const sinceAvailable = Boolean(prior && headSha && prior.headSha !== headSha)
  const commits = row?.tags.find((tag) => tag.kind === 'new-commits')
  const tabs: { id: ReviewTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    {
      id: 'changes',
      label: overview.data
        ? `Changes · ${plural(overview.data.files, 'file')} · +${overview.data.additions} −${overview.data.deletions}`
        : 'Changes',
    },
  ]
  if (sinceAvailable || tab === 'since') {
    tabs.push({
      id: 'since',
      label:
        commits?.kind === 'new-commits'
          ? `Since last review · ${plural(commits.count, 'commit')}`
          : 'Since last review',
    })
  }
  const title = overview.data?.title ?? row?.title ?? `!${target.iid}`

  return (
    <TransportProvider transport={transport}>
      <section className="mr-panel" aria-label={title}>
        <div className="mr-panel-top">
          {header(overview.data, prior)}
          <nav className="mr-tabs" aria-label="MR tabs">
            {tabs.map((item) => (
              <a
                key={item.id}
                href={reviewHash(target, { tab: item.id, full })}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="mr-panel-body">
          {tab === 'overview' ? (
            overview.error ? (
              <div className="mr-error" role="alert">
                <p>
                  {overview.error instanceof Error
                    ? overview.error.message
                    : 'Could not load this merge request.'}
                </p>
                <button type="button" onClick={() => void overview.refetch()}>
                  Retry
                </button>
              </div>
            ) : overview.data ? (
              renderOverview(overview.data, prior)
            ) : (
              <p className="q-empty">Loading…</p>
            )
          ) : previous.isFetchedAfterMount ? (
            <App
              key={`${key}:${tab}`}
              chrome={false}
              showCommentsInitially
              focusNoteId={noteId}
              sinceFrom={tab === 'since' && prior ? prior.headSha : null}
            />
          ) : (
            <p className="q-empty">Loading…</p>
          )}
        </div>
      </section>
    </TransportProvider>
  )
}
