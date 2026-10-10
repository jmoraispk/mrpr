import browser from 'webextension-polyfill'

import type { DeltaConfig } from '../api/types'
import { GitLabClient } from '../gitlab/client'
import { getDiffs, getMergeRequest } from '../gitlab/diffs'
import {
  createInline,
  getDiscussions,
  reply,
  setResolved,
} from '../gitlab/discussions'
import { GitLabError } from '../gitlab/errors'
import { listAuthored, listReviewRequested } from '../gitlab/mergeRequests'
import { getCurrentUser } from '../gitlab/user'
import { showUnread } from '../inbox/badge'
import { pollAll } from '../inbox/poller'
import {
  inboxView,
  loadInbox,
  markAllRead,
  markRead,
  unreadCount,
  updateInbox,
} from '../inbox/store'
import type { InlineCommentInput, ReviewTarget } from '../transport/types'
import {
  getHost,
  getToken,
  hostIdFor,
  listHosts,
  originFor,
  removeHost,
  saveHost,
  type HostConfig,
} from './hosts'
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

async function clientFor(
  target: ReviewTarget,
): Promise<{ client: GitLabClient; host: HostConfig; token: string }> {
  const host = await getHost(target.hostId)
  const token = host ? await getToken(target.hostId) : null
  if (!host || !token) {
    throw new RouterError(
      400,
      'That GitLab host is not configured in Delta',
      'host_not_configured',
    )
  }
  // The user can revoke a host permission in browser settings at any time.
  // Without this check the browser blocks the fetch and the client reports it
  // as `gitlab_unavailable`, telling the user to wait out an outage when the
  // real fix is one permission grant.
  const permitted = await browser.permissions.contains({
    origins: [originFor(host.host)],
  })
  if (!permitted) {
    throw new RouterError(
      403,
      'Delta no longer has permission for this GitLab host',
      'permission_missing',
    )
  }
  return { client: new GitLabClient(host.apiBase, token), host, token }
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
    case 'createDiscussion': {
      const { body, ...selection } = payload as InlineCommentInput
      return createInline(client, project, iid, selection, body)
    }
    case 'replyToDiscussion': {
      const { discussionId, body } = payload as {
        discussionId: string
        body: string
      }
      return reply(client, project, iid, discussionId, body)
    }
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
      return removeHost((payload as { id: string }).id).then(() => null)
    case 'addHost': {
      const { host, apiBase, token } = payload as {
        host: string
        apiBase: string
        token: string
      }
      const user = await getCurrentUser(new GitLabClient(apiBase, token))
      const config: HostConfig = {
        id: hostIdFor(host),
        host: hostIdFor(host),
        apiBase,
        userId: user.id,
        username: user.username,
      }
      await saveHost(config, token)
      return config
    }
    case 'listMergeRequests': {
      const hosts = await listHosts()
      return Promise.all(
        // Everything per host lives inside the try, storage and permission
        // reads included: anything escaping it rejects the Promise.all and
        // collapses every host into one 500, which is the outcome this
        // per-host error object exists to avoid.
        hosts.map(async (host) => {
          try {
            const token = await getToken(host.id)
            if (!token) {
              return { hostId: host.id, error: 'host_not_configured' as const }
            }
            const permitted = await browser.permissions.contains({
              origins: [originFor(host.host)],
            })
            if (!permitted) {
              return {
                hostId: host.id,
                host: host.host,
                error: 'permission_missing' as const,
              }
            }
            const client = new GitLabClient(host.apiBase, token)
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
    case 'listInbox':
      return inboxView(await loadInbox(), await listHosts())
    case 'markRead': {
      const { ids } = payload as { ids: string[] }
      const state = await updateInbox((value) => markRead(value, ids))
      await showUnread(unreadCount(state))
      return null
    }
    case 'markAllRead': {
      const state = await updateInbox(markAllRead)
      await showUnread(unreadCount(state))
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
  let token: string | null = null
  try {
    if (message.kind === 'delta/review') {
      token = await getToken(message.target.hostId)
      return {
        ok: true,
        data: await runReview(message.op, message.target, message.payload),
      }
    }
    if (message.op === 'addHost') {
      // The token is in the payload, not storage yet — scrub it all the same.
      token = (message.payload as { token?: string }).token ?? null
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
