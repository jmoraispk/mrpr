
import { ApiError } from '../api/client'
import type {
  DeltaConfig,
  DiffFile,
  Discussion,
  DiscussionNote,
  MergeRequest,
  PostingResult,
} from '../api/types'
import type { DeltaResponse, ReviewOp } from '../extension/messages'
import { platform } from '../platform/platform'
import type { DeltaTransport, InlineCommentInput, ReviewTarget } from './types'

/** Chrome and Firefox phrase a torn-down worker differently. */
const PORT_CLOSED = /message port closed|Receiving end does not exist/i

/**
 * Ops that may be sent a second time after a torn-down worker.
 *
 * A port-closed rejection says the *response* was lost. It says nothing about
 * whether the worker had already reached GitLab, so repeating an op that
 * creates a new object risks posting the same comment twice — public, visible
 * to the whole team, and cleaned up by hand. Reads are free to repeat, and
 * `setResolved` lands on the same end state whether it runs once or twice.
 *
 * This is a positive list on purpose: a new op added to `ReviewOp` is not
 * retried until someone decides it is safe, which is the direction that fails
 * safely.
 */
const RETRYABLE: ReadonlySet<ReviewOp> = new Set<ReviewOp>([
  'getConfig',
  'getMergeRequest',
  'getDiffs',
  'getDiscussions',
  'setResolved',
])

/**
 * One code for both paths — exhausted retry and refused retry — so the page
 * has a single case to handle. The wording differs: for a write that was never
 * retried the honest statement is that the outcome is unknown.
 */
function unavailable(op: ReviewOp): ApiError {
  return new ApiError(
    503,
    RETRYABLE.has(op)
      ? 'The Delta background service is not responding. Reload the page.'
      : 'Delta lost contact with its background service. Your comment may or ' +
        'may not have been posted; reload to check before retrying.',
    'extension_unavailable',
  )
}

async function sendOnce(
  op: ReviewOp,
  target: ReviewTarget,
  payload?: unknown,
): Promise<DeltaResponse> {
  return platform().send({ kind: 'delta/review', op, target, payload })
}

async function send<T>(
  op: ReviewOp,
  target: ReviewTarget,
  payload?: unknown,
): Promise<T> {
  let response: DeltaResponse
  try {
    response = await sendOnce(op, target, payload)
  } catch (error) {
    if (!PORT_CLOSED.test(String(error))) throw error
    if (!RETRYABLE.has(op)) throw unavailable(op)
    try {
      response = await sendOnce(op, target, payload)
    } catch {
      throw unavailable(op)
    }
  }
  if (!response.ok) {
    throw new ApiError(
      response.error.status,
      response.error.message,
      response.error.code,
    )
  }
  return response.data as T
}

export function createRuntimeTransport(target: ReviewTarget): DeltaTransport {
  return {
    targetKey: `${target.hostId}/${target.project}/${target.iid}`,
    getConfig: () => send<DeltaConfig>('getConfig', target),
    getMergeRequest: () => send<MergeRequest>('getMergeRequest', target),
    getDiffs: () => send<DiffFile[]>('getDiffs', target),
    getDiscussions: () => send<Discussion[]>('getDiscussions', target),
    createDiscussion: (input: InlineCommentInput) =>
      send<PostingResult>('createDiscussion', target, input),
    replyToDiscussion: (discussionId, body) =>
      send<DiscussionNote>('replyToDiscussion', target, {
        discussionId,
        body,
      }),
    setResolved: (discussionId, resolved) =>
      send<Discussion>('setResolved', target, { discussionId, resolved }),
  }
}
