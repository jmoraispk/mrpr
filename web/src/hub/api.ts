import { ApiError } from '../api/client'
import type { HubOp } from '../core/messages'
import type { MergeRequestPage } from '../gitlab/mergeRequests'
import { platform } from '../platform/platform'

export interface HostSummary {
  hostId: string
  host?: string
  reviewing?: MergeRequestPage
  authored?: MergeRequestPage
  error?: string
}

export async function hubRequest<T>(
  op: HubOp,
  payload?: unknown,
): Promise<T> {
  const response = await platform().send({ kind: 'delta/hub', op, payload })
  if (!response.ok) {
    throw new ApiError(
      response.error.status,
      response.error.message,
      response.error.code,
    )
  }
  return response.data as T
}
