import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { ErrorState } from './review/ErrorState'
import { FileTree } from './review/FileTree'
import { diffStats, diffStatsLabel } from './review/diffStats'
import { projectUrlFrom } from './review/projectUrl'
import type { ScrollRequest } from './review/DiffStream'
import { MODE_KEY, ReviewToolbar } from './review/ReviewToolbar'
import type { DiffMode } from './review/diffWorkerClient'
import {
  discussionsQueryKey,
  mergeFetchedDiscussions,
} from './review/discussionCache'
import { focusThread, locateNote } from './review/noteFocus'
import { useTransport } from './transport/context'

const DiffStream = lazy(() =>
  import('./review/DiffStream').then((module) => ({
    default: module.DiffStream,
  })),
)
const GeneralDiscussionsPanel = lazy(() =>
  import('./review/GeneralDiscussionsPanel').then((module) => ({
    default: module.GeneralDiscussionsPanel,
  })),
)

type UpdateState = 'idle' | 'updating' | 'success' | 'error'

export interface AppProps {
  /** Open with this note's thread in view, e.g. from the extension inbox. */
  focusNoteId?: number | null
}

export function App({ focusNoteId = null }: AppProps = {}) {
  const queryClient = useQueryClient()
  const transport = useTransport()
  const [requestedFileIndex, setRequestedFileIndex] = useState(0)
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(
    null,
  )
  const scrollNonce = useRef(0)
  // The review controls live in the header, so their state lives here.
  const [mode, setMode] = useState<DiffMode>(() =>
    localStorage.getItem(MODE_KEY) === 'split' ? 'split' : 'unified',
  )
  const [showComments, setShowComments] = useState(false)
  const [inlineCount, setInlineCount] = useState(0)
  const [showGeneralDiscussions, setShowGeneralDiscussions] =
    useState(false)
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const diffFocusRef = useRef<HTMLElement>(null)
  const config = useQuery({
    queryKey: ['config', transport.targetKey],
    queryFn: () => transport.getConfig(),
    staleTime: 30_000,
  })
  const mergeRequest = useQuery({
    queryKey: ['merge-request', transport.targetKey],
    queryFn: ({ signal }) => transport.getMergeRequest(signal),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const diffs = useQuery({
    queryKey: ['diffs', transport.targetKey],
    queryFn: ({ signal }) => transport.getDiffs(signal),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const discussions = useQuery({
    queryKey: discussionsQueryKey(transport.targetKey),
    queryFn: async ({ signal }) =>
      mergeFetchedDiscussions(
        queryClient,
        transport.targetKey,
        await transport.getDiscussions(signal),
      ),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const totalChanges = useMemo(
    () =>
      (diffs.data ?? []).reduce(
        (total, file) => {
          const stats = diffStats(file.diff)
          total.additions += stats.additions
          total.deletions += stats.deletions
          return total
        },
        { additions: 0, deletions: 0 },
      ),
    [diffs.data],
  )
  const changeSummary = useMemo(() => {
    const counts = { added: 0, deleted: 0, moved: 0 }
    for (const file of diffs.data ?? []) {
      if (file.new_file) counts.added += 1
      else if (file.deleted_file) counts.deleted += 1
      else if (file.renamed_file) counts.moved += 1
    }
    return counts
  }, [diffs.data])
  const generalDiscussions = useMemo(
    () =>
      (discussions.data ?? []).filter((discussion) =>
        discussion.notes.every((note) => !note.position),
      ),
    [discussions.data],
  )

  const [focusNotice, setFocusNotice] = useState<string | null>(null)
  const focusedNote = useRef<number | null>(null)
  const cancelFocus = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelFocus.current?.(), [])
  // Once per note: a later refetch of discussions must not yank the reader
  // back to the thread they arrived at.
  useEffect(() => {
    if (!focusNoteId || focusedNote.current === focusNoteId) return
    if (!diffs.data || !discussions.data) return
    focusedNote.current = focusNoteId
    cancelFocus.current?.()
    const location = locateNote(discussions.data, diffs.data, focusNoteId)
    const notFound = () =>
      setFocusNotice(
        'The comment you opened is no longer on this merge request’s current diff.',
      )
    if (!location) {
      notFound()
      return
    }
    setFocusNotice(null)
    if (location.kind === 'inline') {
      setShowComments(true)
      setRequestedFileIndex(location.fileIndex)
      scrollNonce.current += 1
      setScrollRequest({
        index: location.fileIndex,
        nonce: scrollNonce.current,
        discussionId: location.discussionId,
      })
    } else {
      setShowGeneralDiscussions(true)
    }
    cancelFocus.current = focusThread(location.discussionId, {
      scroll: location.kind === 'general',
      onMissing: notFound,
    })
  }, [focusNoteId, diffs.data, discussions.data])

  const requiredQueries = [config, mergeRequest, diffs]
  const error = requiredQueries.find(
    (query) => query.error && query.data === undefined,
  )?.error
  const isPending = requiredQueries.some((query) => query.isPending)

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
            void Promise.all(
              requiredQueries.map((query) => query.refetch()),
            )
        }}
      />
    )
  }

  if (isPending || !config.data || !mergeRequest.data || !diffs.data) {
    return (
      <main className="state-screen" aria-live="polite">
        <div className="delta-loader" aria-hidden="true" />
        <p>Loading merge request…</p>
      </main>
    )
  }

  const activeFileIndex = Math.min(
    requestedFileIndex,
    Math.max(0, diffs.data.length - 1),
  )
  const activeFile = diffs.data[activeFileIndex]
  const threadCount = discussions.data?.length ?? 0
  const projectUrl = projectUrlFrom(mergeRequest.data.web_url)

  async function updateReview() {
    const activeFilePath = activeFile?.new_path ?? activeFile?.old_path
    setUpdateState('updating')

    try {
      const [mergeRequestResult, diffsResult, discussionsResult] =
        await Promise.all([
          mergeRequest.refetch(),
          diffs.refetch(),
          discussions.refetch(),
        ])
      const refreshedFileIndex = activeFilePath
        ? diffsResult.data?.findIndex(
            (file) =>
              file.new_path === activeFilePath ||
              file.old_path === activeFilePath,
          )
        : undefined

      if (refreshedFileIndex !== undefined && refreshedFileIndex >= 0) {
        setRequestedFileIndex(refreshedFileIndex)
      }

      setUpdateState(
        [mergeRequestResult, diffsResult, discussionsResult].some(
          (result) => result.error,
        )
          ? 'error'
          : 'success',
      )
    } catch {
      setUpdateState('error')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={mergeRequest.data.web_url}>
          <span className="brand-mark" aria-hidden="true" />
          <span>Mr. PR</span>
        </a>
        <div className="repository-context">
          {projectUrl ? (
            <a
              className="context-link"
              href={projectUrl}
              target="_blank"
              rel="noreferrer"
            >
              {config.data.project}
            </a>
          ) : (
            <span>{config.data.project}</span>
          )}
          <span className="separator" aria-hidden="true">
            /
          </span>
          <a
            className="context-link"
            href={mergeRequest.data.web_url}
            target="_blank"
            rel="noreferrer"
          >
            <strong>!{mergeRequest.data.iid}</strong>
          </a>
        </div>
        <div className="topbar-meta">
          <span className="connection-dot" aria-hidden="true" />
          <span>{config.data.host}</span>
        </div>
      </header>

      <div className="review-workspace">
        <aside className="file-rail" aria-label="Changed files">
          <div className="rail-heading">
            <div>
              <span className="eyebrow">Changes</span>
              <strong>{diffs.data.length} files</strong>
              <span
                className="rail-diff-stats"
                aria-label={`Total changes: ${diffStatsLabel(totalChanges)}`}
              >
                <span className="stat-addition" aria-hidden="true">
                  +{totalChanges.additions}
                </span>
                <span className="stat-deletion" aria-hidden="true">
                  −{totalChanges.deletions}
                </span>
              </span>
              <span
                className="change-summary"
                aria-label={
                  `${changeSummary.added} new, ` +
                  `${changeSummary.deleted} deleted, ` +
                  `${changeSummary.moved} moved`
                }
              >
                <span className="count-new" aria-hidden="true">
                  {changeSummary.added} new
                </span>
                <span className="count-del" aria-hidden="true">
                  {changeSummary.deleted} del
                </span>
                <span className="count-mov" aria-hidden="true">
                  {changeSummary.moved} mov
                </span>
              </span>
            </div>
            <span className="thread-count" title="Discussion count">
              {threadCount}
            </span>
          </div>
          <FileTree
            files={diffs.data}
            activeIndex={activeFileIndex}
            onSelect={(index) => {
              if (index !== activeFileIndex) setUpdateState('idle')
              setRequestedFileIndex(index)
              scrollNonce.current += 1
              setScrollRequest({ index, nonce: scrollNonce.current })
            }}
            onFocusDiff={() => diffFocusRef.current?.focus()}
          />
        </aside>

        <main className="review-main" ref={diffFocusRef} tabIndex={-1}>
          <section className="merge-request-heading">
            <div className="heading-copy">
              <span className="eyebrow">
                {mergeRequest.data.state} · {mergeRequest.data.source_branch}
                <span aria-hidden="true"> → </span>
                {mergeRequest.data.target_branch}
              </span>
              <h1>{mergeRequest.data.title}</h1>
            </div>
            <div className="heading-actions">
              <div className="heading-actions-primary">
              <a
                className="gitlab-link"
                href={mergeRequest.data.web_url}
                target="_blank"
                rel="noreferrer"
              >
                Open in GitLab <span aria-hidden="true">↗</span>
              </a>
              <button
                className="review-update"
                disabled={updateState === 'updating'}
                type="button"
                onClick={() => void updateReview()}
              >
                {updateState === 'updating' ? 'Updating…' : 'Update'}
              </button>
              {generalDiscussions.length > 0 ? (
                <button
                  className="mr-discussions-toggle"
                  aria-expanded={showGeneralDiscussions}
                  type="button"
                  onClick={() =>
                    setShowGeneralDiscussions((visible) => !visible)
                  }
                >
                  MR discussions ({generalDiscussions.length})
                </button>
              ) : null}
              {discussions.error ? (
                <button
                  className="discussion-load-error"
                  aria-label="Retry loading discussions"
                  type="button"
                  onClick={() => void discussions.refetch()}
                >
                  Comments unavailable · Retry
                </button>
              ) : null}
              {updateState === 'success' ? (
                <span className="update-status" aria-live="polite">
                  Review updated.
                </span>
              ) : null}
              {updateState === 'error' ? (
                <span className="update-status" aria-live="polite">
                  Review could not be fully updated.
                </span>
              ) : null}
              </div>
              <ReviewToolbar
                inlineCount={inlineCount}
                mode={mode}
                showComments={showComments}
                onModeChange={setMode}
                onToggleComments={() =>
                  setShowComments((visible) => !visible)
                }
              />
            </div>
          </section>

          {focusNotice ? (
            <p className="focus-notice" role="status">
              {focusNotice}
            </p>
          ) : null}

          {showGeneralDiscussions ? (
            <Suspense
              fallback={
                <section className="mr-discussions-panel">
                  Loading discussions…
                </section>
              }
            >
              <GeneralDiscussionsPanel
                discussions={generalDiscussions}
                onClose={() => setShowGeneralDiscussions(false)}
              />
            </Suspense>
          ) : null}

          {activeFile ? (
            <Suspense
              fallback={
                <section className="diff-stage diff-loading">
                  Preparing diff…
                </section>
              }
            >
              <DiffStream
                activeIndex={activeFileIndex}
                discussions={discussions.data ?? []}
                files={diffs.data}
                mode={mode}
                scrollRef={diffFocusRef}
                scrollRequest={scrollRequest}
                showComments={showComments}
                onActiveIndexChange={setRequestedFileIndex}
                onInlineCountChange={setInlineCount}
                onRequestShowComments={() => setShowComments(true)}
              />
            </Suspense>
          ) : (
            <section className="empty-review">
              <h2>No changed files</h2>
              <p>This merge request does not contain a renderable diff.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
