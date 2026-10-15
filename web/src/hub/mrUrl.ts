import type { HostConfig } from '../core/hosts'
import { hostIdFor } from '../core/hosts'
import type { ReviewTarget } from '../transport/types'

/** Mirrors `_MR_PATH` in src/delta_review/config.py. */
const MR_PATH = /^\/(?<project>.+)\/-\/merge_requests\/(?<iid>\d+)(?:\/.*)?$/

export function parseMergeRequestUrl(
  url: string,
  hosts: HostConfig[],
): ReviewTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const hostId = hostIdFor(parsed.hostname)
  if (!hosts.some((host) => host.id === hostId)) return null

  const match = MR_PATH.exec(parsed.pathname)
  if (!match?.groups) return null

  return {
    hostId,
    project: match.groups.project.replace(/\.git$/, ''),
    iid: Number(match.groups.iid),
  }
}
