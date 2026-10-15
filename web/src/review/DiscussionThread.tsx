import { useMutation, useQueryClient } from '@tanstack/react-query'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useState, type FormEvent } from 'react'

import type { Discussion, DiscussionNote } from '../api/types'
import { shortTime } from '../hub/relativeTime'
import { useTransport } from '../transport/context'
import { discussionsQueryKey } from './discussionCache'
import { ReviewerMark } from './ReviewerMark'

const remarkPlugins = [remarkGfm]
const rehypePlugins = [rehypeRaw, rehypeSanitize]

interface DiscussionThreadProps {
  discussion: Discussion
  rangeLabel?: string
  /** Called after a reply or resolve settles, for views that show the thread from other data. */
  onChanged?: () => void
  /** 'chat': bubbles, the opener left and everyone else right (the MR page's Activity). */
  variant?: 'default' | 'chat'
}

function updateCachedDiscussion(
  discussions: Discussion[] | undefined,
  discussionId: string,
  update: (discussion: Discussion) => Discussion,
): Discussion[] | undefined {
  return discussions?.map((discussion) =>
    discussion.id === discussionId ? update(discussion) : discussion,
  )
}

export function DiscussionThread({
  discussion,
  rangeLabel,
  onChanged,
  variant = 'default',
}: DiscussionThreadProps) {
  const chat = variant === 'chat'
  const queryClient = useQueryClient()
  const transport = useTransport()
  const queryKey = discussionsQueryKey(transport.targetKey)
  const [current, setCurrent] = useState(discussion)
  const [draft, setDraft] = useState('')

  useEffect(() => setCurrent(discussion), [discussion])

  const reply = useMutation({
    mutationFn: (body: string) =>
      transport.replyToDiscussion(current.id, body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey })
      const snapshot = queryClient.getQueryData<Discussion[]>(queryKey)
      const previous = current
      const optimisticNote: DiscussionNote = {
        id: `optimistic-${Date.now()}`,
        body,
        author: { name: 'You', username: 'you' },
      }
      const update = (value: Discussion): Discussion => ({
        ...value,
        notes: [...value.notes, optimisticNote],
      })
      setCurrent(update)
      queryClient.setQueryData<Discussion[]>(queryKey, (values) =>
        updateCachedDiscussion(values, current.id, update),
      )
      return { snapshot, previous, optimisticId: optimisticNote.id }
    },
    onError: (_error, _body, context) => {
      if (context) {
        setCurrent(context.previous)
        queryClient.setQueryData(queryKey, context.snapshot)
      }
    },
    onSuccess: (note, _body, context) => {
      const replaceOptimistic = (value: Discussion): Discussion => ({
        ...value,
        notes: value.notes.map((existing) =>
          existing.id === context.optimisticId ? note : existing,
        ),
      })
      setCurrent(replaceOptimistic)
      queryClient.setQueryData<Discussion[]>(queryKey, (values) =>
        updateCachedDiscussion(values, current.id, replaceOptimistic),
      )
      setDraft('')
    },
    onSettled: () => {
      onChanged?.()
      return queryClient.invalidateQueries({ queryKey })
    },
  })

  const resolvableNote = current.notes.find((note) => note.resolvable)
  const isResolved = Boolean(resolvableNote?.resolved)
  const resolution = useMutation({
    mutationFn: (resolved: boolean) =>
      transport.setResolved(current.id, resolved),
    onMutate: async (resolved) => {
      await queryClient.cancelQueries({ queryKey })
      const snapshot = queryClient.getQueryData<Discussion[]>(queryKey)
      const previous = current
      const update = (value: Discussion): Discussion => ({
        ...value,
        notes: value.notes.map((note) =>
          note.resolvable ? { ...note, resolved } : note,
        ),
      })
      setCurrent(update)
      queryClient.setQueryData<Discussion[]>(queryKey, (values) =>
        updateCachedDiscussion(values, current.id, update),
      )
      return { snapshot, previous }
    },
    onError: (_error, _resolved, context) => {
      if (context) {
        setCurrent(context.previous)
        queryClient.setQueryData(queryKey, context.snapshot)
      }
    },
    onSettled: () => {
      onChanged?.()
      return queryClient.invalidateQueries({ queryKey })
    },
  })

  function submitReply(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (body && !reply.isPending) reply.mutate(body)
  }

  const opener = current.notes[0]?.author?.username
  return (
    <article
      className={`discussion-thread${chat ? ' is-chat' : ''}`}
      data-discussion-id={current.id}
      tabIndex={-1}
    >
      <header className="thread-heading">
        {chat ? null : (
          <span className="thread-author">
            {current.notes[0]?.author?.name ?? 'GitLab reviewer'}
          </span>
        )}
        {rangeLabel ? (
          <span className="discussion-range-label">{rangeLabel}</span>
        ) : null}
        {resolvableNote ? (
          <span
            className={`resolution-state ${isResolved ? 'is-resolved' : ''}`}
          >
            {isResolved ? 'Resolved' : 'Open'}
          </span>
        ) : null}
      </header>

      <div className="thread-notes">
        {current.notes.map((note) =>
          chat ? (
            <div
              className={`thread-note chat-note ${
                note.author?.username === opener ? 'is-opener' : 'is-reply'
              }`}
              key={note.id}
            >
              <ReviewerMark author={note.author} />
              <div className="chat-body">
                <p className="chat-meta">
                  <strong>{note.author?.name ?? 'Reviewer'}</strong>
                  {note.created_at ? (
                    <>
                      {' · '}
                      <time dateTime={note.created_at}>
                        {shortTime(note.created_at)}
                      </time>
                    </>
                  ) : null}
                </p>
                <div className="note-markdown chat-bubble">
                  <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                  >
                    {note.body}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            <div className="thread-note" key={note.id}>
              <ReviewerMark author={note.author} />
              <div>
                {note !== current.notes[0] ? (
                  <strong>{note.author?.name ?? 'Reviewer'}</strong>
                ) : null}
                <div className="note-markdown">
                  <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                  >
                    {note.body}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ),
        )}
      </div>

      <form className="reply-form" onSubmit={submitReply}>
        <label>
          <span>Reply</span>
          <textarea
            aria-label="Reply"
            maxLength={1_000_000}
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <div className="thread-actions">
          {resolvableNote ? (
            <button
              type="button"
              disabled={resolution.isPending}
              onClick={() => resolution.mutate(!isResolved)}
            >
              {isResolved ? 'Unresolve' : 'Resolve'}
            </button>
          ) : null}
          <button
            className="primary-action"
            type="submit"
            disabled={!draft.trim() || reply.isPending}
          >
            Reply
          </button>
        </div>
      </form>
      {reply.error || resolution.error ? (
        <p className="mutation-error" role="alert">
          {(reply.error ?? resolution.error)?.message}
        </p>
      ) : null}
    </article>
  )
}
