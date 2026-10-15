import type { DeltaConfig } from '../api/types'
import { getDiffs, getMergeRequest } from '../gitlab/diffs'
import {
  createInline,
  getDiscussions,
  reply,
  setResolved,
} from '../gitlab/discussions'
import { GitLabError } from '../gitlab/errors'
import { listAuthored, listReviewRequested } from '../gitlab/mergeRequests'
import { fetchMrOverview } from '../gitlab/mrOverview'
import { fetchQueueMrs, fetchRepoMrs, type QueueHost, type QueueMr } from '../gitlab/queueFacts'
import {
  approve,
  commitsSince,
  diffsSince,
  postComment,
  rebase,
  unapprove,
} from '../gitlab/reviewActions'
import { withSignature } from '../gitlab/signature'
import { pollAll } from '../inbox/poller'
import {
  inboxView,
  loadInbox,
  markAllRead,
  markRead,
  unreadCount,
  updateInbox,
} from '../inbox/store'
import { platform } from '../platform/platform'
import type { InlineCommentInput, ReviewTarget } from '../transport/types'
import { getHost, listHosts } from './hosts'
import type { DeltaMessage, DeltaResponse } from './messages'
import { scrubToken } from './scrub'

export { scrubToken }

class RouterError extends Error {
  readonly status: number
  readonly code: string

  // Fields are assigned in the body rather than declared as constructor
  // parameter properties: the app tsconfig sets `erasableSyntaxOnly`.
  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'RouterError'
    this.status = status
    this.code = code
  }
}

async function clientFor(target: ReviewTarget) {
  const host = await getHost(target.hostId)
  if (!host) {
    throw new RouterError(
      400,
      'That GitLab host is not configured in Delta',
      'host_not_configured',
    )
  }
  return { client: await platform().clientFor(host), host }
}

async function runReview(
  op: string,
  target: ReviewTarget,
  payload: unknown,
): Promise<unknown> {
  const { client, host } = await clientFor(target)
  const { project, iid } = target
  switch (op) {
    case 'getConfig':
      return { host: host.host, project, mr_iid: iid } satisfies DeltaConfig
    case 'getMergeRequest':
      return getMergeRequest(client, project, iid)
    case 'getDiffs':
      return getDiffs(client, project, iid)
    case 'getDiscussions':
      return getDiscussions(client, project, iid)
    // Every comment Mr. PR posts is signed here, in one place.
    case 'createDiscussion': {
      const { body, ...selection } = payload as InlineCommentInput
      return createInline(client, project, iid, selection, withSignature(body))
    }
    case 'replyToDiscussion': {
      const { discussionId, body } = payload as {
        discussionId: string
        body: string
      }
      return reply(client, project, iid, discussionId, withSignature(body))
    }
    case 'postComment':
      return postComment(client, project, iid, withSignature((payload as { body: string }).body))
    case 'approve':
      return approve(client, project, iid).then(() => null)
    case 'unapprove':
      return unapprove(client, project, iid).then(() => null)
    case 'getDiffsSince': {
      const { from } = payload as { from: string }
      const mr = await getMergeRequest(client, project, iid)
      if (!mr.sha) {
        throw new RouterError(409, 'This merge request has no commits to compare', 'no_head')
      }
      return diffsSince(client, project, from, mr.sha)
    }
    case 'getDiffsBetween': {
      const { from, to } = payload as { from: string; to: string }
      return diffsSince(client, project, from, to)
    }
    case 'getOverview':
      return fetchMrOverview(client, project, iid)
    case 'rebase':
      return rebase(client, project, iid).then(() => null)
    case 'commitsSince':
      return commitsSince(client, project, iid, (payload as { sha: string }).sha)
    case 'setResolved': {
      const { discussionId, resolved } = payload as {
        discussionId: string
        resolved: boolean
      }
      return setResolved(client, project, iid, discussionId, resolved)
    }
    default:
      throw new RouterError(400, `Unknown review op: ${op}`, 'unknown_op')
  }
}

async function runHub(op: string, payload: unknown): Promise<unknown> {
  switch (op) {
    case 'listHosts':
      return listHosts()
    case 'removeHost':
      return platform()
        .disconnectHost((payload as { id: string }).id)
        .then(() => null)
    case 'addHost':
      return platform().connectHost(
        payload as { host: string; apiBase: string; token?: string },
      )
    case 'listMergeRequests': {
      const hosts = await listHosts()
      return Promise.all(
        // Everything per host lives inside the try: anything escaping it
        // rejects the Promise.all and collapses every host into one 500,
        // which is the outcome this per-host error object exists to avoid.
        hosts.map(async (host) => {
          try {
            const client = await platform().clientFor(host)
            const [reviewing, authored] = await Promise.all([
              listReviewRequested(client, host.userId),
              listAuthored(client, host.userId),
            ])
            return { hostId: host.id, host: host.host, reviewing, authored }
          } catch (error) {
            return {
              hostId: host.id,
              host: host.host,
              error: error instanceof GitLabError ? error.code : 'gitlab_error',
            }
          }
        }),
      )
    }
    case 'listQueue': {
      const hosts = await listHosts()
      // As with listMergeRequests: one host failing must not hide the others.
      return Promise.all(
        hosts.map(async (host): Promise<QueueHost> => {
          const base = { hostId: host.id, host: host.host, username: host.username }
          try {
            const mrs = await fetchQueueMrs(await platform().clientFor(host))
            return { ...base, mrs, error: null }
          } catch (error) {
            return {
              ...base,
              mrs: [],
              error: error instanceof GitLabError ? error.code : 'gitlab_error',
            }
          }
        }),
      )
    }
    case 'listRepoMrs': {
      const { repos } = payload as { repos: Record<string, string[]> }
      const hosts = await listHosts()
      const out: Record<string, QueueMr[]> = {}
      await Promise.all(
        hosts
          .filter((host) => repos[host.id]?.length)
          .map(async (host) => {
            try {
              out[host.id] = await fetchRepoMrs(
                await platform().clientFor(host),
                repos[host.id].slice(0, 20),
              )
            } catch {
              // All MRs is extra: a failure leaves the list as it was.
              out[host.id] = []
            }
          }),
      )
      return out
    }
    case 'listInbox':
      return inboxView(await loadInbox(), await listHosts())
    case 'markRead': {
      const { ids } = payload as { ids: string[] }
      const state = await updateInbox((value) => markRead(value, ids))
      await platform().showUnread(unreadCount(state))
      return null
    }
    case 'markAllRead': {
      const state = await updateInbox(markAllRead)
      await platform().showUnread(unreadCount(state))
      return null
    }
    case 'pollNow': {
      const { maxAgeMs } = (payload ?? {}) as { maxAgeMs?: number }
      await pollAll({ maxAgeMs })
      return inboxView(await loadInbox(), await listHosts())
    }
    default:
      throw new RouterError(400, `Unknown hub op: ${op}`, 'unknown_op')
  }
}

export async function handleMessage(
  message: DeltaMessage,
): Promise<DeltaResponse> {
  // GitLabClient scrubs its own credential. A token arriving in an addHost
  // payload is scrubbed here as well, since it may surface before any
  // client holds it.
  const token =
    message.kind === 'delta/hub' && message.op === 'addHost'
      ? ((message.payload as { token?: string }).token ?? null)
      : null
  try {
    if (message.kind === 'delta/review') {
      return {
        ok: true,
        data: await runReview(message.op, message.target, message.payload),
      }
    }
    return { ok: true, data: await runHub(message.op, message.payload) }
  } catch (error) {
    if (error instanceof GitLabError || error instanceof RouterError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: scrubToken(error.message, token),
          status: error.status,
        },
      }
    }
    return {
      ok: false,
      error: {
        code: 'delta_internal_error',
        message: scrubToken(
          error instanceof Error ? error.message : String(error),
          token,
        ),
        status: 500,
      },
    }
  }
}
