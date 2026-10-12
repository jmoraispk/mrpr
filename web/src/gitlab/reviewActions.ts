import type { DiffFile, Discussion } from '../api/types'
import type { GitLabClient } from './client'
import { mergeRequestPath } from './diffs'

export async function approve(client: GitLabClient, project: string, iid: number): Promise<void> {
  await client.request('POST', `${mergeRequestPath(project, iid)}/approve`)
}

export async function unapprove(
  client: GitLabClient,
  project: string,
  iid: number,
): Promise<void> {
  await client.request('POST', `${mergeRequestPath(project, iid)}/unapprove`)
}

/** A new MR-level discussion: how requests for changes and nudges are posted. */
export async function postComment(
  client: GitLabClient,
  project: string,
  iid: number,
  body: string,
): Promise<Discussion> {
  return client.request<Discussion>('POST', `${mergeRequestPath(project, iid)}/discussions`, {
    json: { body },
  })
}

function toDiffFile(raw: Record<string, unknown>): DiffFile {
  return {
    old_path: String(raw.old_path ?? ''),
    new_path: String(raw.new_path ?? ''),
    diff: String(raw.diff ?? ''),
    new_file: Boolean(raw.new_file),
    renamed_file: Boolean(raw.renamed_file),
    deleted_file: Boolean(raw.deleted_file),
    collapsed: Boolean(raw.collapsed),
    too_large: Boolean(raw.too_large),
  }
}

/** What changed between two commits: the "since your last review" diff. */
export async function diffsSince(
  client: GitLabClient,
  project: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<DiffFile[]> {
  const result = await client.request<{ diffs?: Record<string, unknown>[] }>(
    'GET',
    `/projects/${encodeURIComponent(project)}/repository/compare`,
    { params: { from, to, straight: 'false' }, signal },
  )
  return (result.diffs ?? []).map(toDiffFile)
}

/** Commits on the MR newer than `sha`. */
export async function commitsSince(
  client: GitLabClient,
  project: string,
  iid: number,
  sha: string,
): Promise<number> {
  const commits = await client.paginate<{ id: string }>(
    `${mergeRequestPath(project, iid)}/commits`,
  )
  const index = commits.findIndex((commit) => commit.id === sha)
  // Not found: history was rewritten since the last look, so everything is new.
  return index >= 0 ? index : Math.max(1, commits.length)
}
