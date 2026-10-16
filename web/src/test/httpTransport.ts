import { ApiError } from '../api/client'
import type {
  MrprConfig,
  DiffFile,
  Discussion,
  DiscussionNote,
  MergeRequest,
  PostingResult,
} from '../api/types'
import type { MrprTransport } from '../transport/types'

/**
 * A transport backed by the `/api/*` handlers in `./server`.
 *
 * Mr. PR ships no HTTP backend: the site talks to GitLab from the browser.
 * This exists only so component tests can drive a transport over msw, where
 * per-test `server.use` overrides make failures easy to stage. Nothing here
 * runs in the app.
 */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')

  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      code?: string
      detail?: string
      message?: string
    } | null
    throw new ApiError(
      response.status,
      payload?.message ??
        payload?.detail ??
        `Request failed (${response.status})`,
      payload?.code,
    )
  }
  return response.json() as Promise<T>
}

export function createHttpTransport(): MrprTransport {
  return {
    targetKey: 'test',
    getConfig: () => api<MrprConfig>('/api/config'),
    getMergeRequest: (signal) => api<MergeRequest>('/api/mr', { signal }),
    getDiffs: (signal) => api<DiffFile[]>('/api/diffs', { signal }),
    getDiscussions: (signal) =>
      api<Discussion[]>('/api/discussions', { signal }),
    createDiscussion: (input) =>
      api<PostingResult>('/api/discussions', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    replyToDiscussion: (discussionId, body) =>
      api<DiscussionNote>(
        `/api/discussions/${encodeURIComponent(discussionId)}/notes`,
        { method: 'POST', body: JSON.stringify({ body }) },
      ),
    setResolved: (discussionId, resolved) =>
      api<Discussion>(`/api/discussions/${encodeURIComponent(discussionId)}`, {
        method: 'PUT',
        body: JSON.stringify({ resolved }),
      }),
  }
}
