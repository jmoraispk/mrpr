import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
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
  /** Open showing only what changed since your last review, when there was one. */
  startSince?: boolean
}

export function App({ focusNoteId = null, startSince = false }: AppProps = {}) {
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
    // Each visit reads the head afresh: "since your last review" depends on it.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  // The head you reviewed before this visit: read fresh as the review opens,
  // then never again, so it keeps meaning "before" after this visit records a
  // new look. Readiness waits for this visit's read, not a cached earlier one.
  const lastLook = useQuery({
    queryKey: ['last-look', transport.targetKey],
    queryFn: async () => (await transport.lastLook?.()) ?? null,
    staleTime: Infinity,
    refetchOnMount: 'always',
    enabled: Boolean(transport.lastLook),
  })
  const lastLookReady = !transport.lastLook || lastLook.isFetchedAfterMount
  const [sinceChosen, setSince] = useState(startSince)
  // This visit's head, never a cached one from an earlier visit.
  const headSha = mergeRequest.isFetchedAfterMount ? mergeRequest.data?.sha : undefined
  // Only when the head moved since that look is there anything to show.
  const sinceAvailable = Boolean(
    lastLook.data && transport.getDiffsSince && headSha && lastLook.data !== headSha,
  )
  const sinceFrom = sinceChosen && sinceAvailable ? lastLook.data! : null
  const diffs = useQuery({
    queryKey: ['diffs', transport.targetKey, sinceFrom ?? 'all'],
    queryFn: ({ signal }) =>
      sinceFrom
        ? transport.getDiffsSince!(sinceFrom, signal)
        : transport.getDiffs(signal),
    // Toggling "since" swaps the file list in place, not behind a loading screen.
    placeholderData: keepPreviousData,
    // Opening straight into "since": wait to learn what "since" means.
    enabled: !startSince || (lastLookReady && mergeRequest.isFetchedAfterMount),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [approved, setApproved] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const looked = useRef(false)
  useEffect(() => {
    if (looked.current || !headSha || !transport.markLooked || !lastLookReady) return
    looked.current = true
    void transport.markLooked(headSha)
  }, [headSha, transport, lastLookReady])
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

  async function approveMergeRequest() {
    try {
      await transport.approve!()
      setApproved(true)
      setApproveError(null)
      // Approving counts as a look.
      if (headSha) void transport.markLooked?.(headSha)
    } catch {
      setApproveError("Couldn't approve. GitLab may not let you approve this one.")
    }
  }

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
              {sinceAvailable ? (
                <button
                  className="review-since"
                  aria-pressed={Boolean(sinceFrom)}
                  type="button"
                  onClick={() => setSince((value) => !value)}
                >
                  Since your last review
                </button>
              ) : null}
              {sinceFrom ? (
                <span className="update-status">
                  Only what changed since your last review; switch back to comment inline.
                </span>
              ) : null}
              {transport.approve ? (
                approved ? (
                  <span className="review-approved">Approved</span>
                ) : (
                  <button
                    className="review-approve"
                    type="button"
                    onClick={() => void approveMergeRequest()}
                  >
                    Approve
                  </button>
                )
              ) : null}
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
              {approveError ? (
                <span className="update-status" role="alert">
                  {approveError}
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
                readOnly={Boolean(sinceFrom)}
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
