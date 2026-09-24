import type { GitLabClient } from './client'

/** Why a merge request is in the involved set. */
export type Role = 'author' | 'reviewer' | 'assignee' | 'mentioned' | 'commenter'

export interface MergeRequestRef {
  /** Numeric global id: what `mergeRequest(id:)` and the events API use. */
  id: number
  iid: number
  project: string
  title: string
  webUrl: string
  updatedAt: string
}

export interface InvolvedMergeRequest extends MergeRequestRef {
  roles: Role[]
}

export interface Involved {
  /** Open merge requests from the user's lists, one entry each. */
  listed: InvolvedMergeRequest[]
  /** Per extra id asked about. Absent when GitLab returned nothing for it. */
  extra: Record<number, { updatedAt: string; state: string }>
}

export interface ActivityNote {
  id: number
  system: boolean
  createdAt: string
  url: string
  body: string
  author: {
    name: string
    username: string
    avatarUrl: string | null
    bot: boolean
  } | null
}

export interface ActivityDiscussion {
  /** The REST discussion id, which the review view keys threads by. */
  id: string
  notes: ActivityNote[]
}

export interface MergeRequestActivity extends MergeRequestRef {
  state: string
  discussions: ActivityDiscussion[]
}

const PAGE = 100
/** Merge requests per activity request, keeping each response a sane size. */
const BATCH = 10

const MR_FIELDS = 'id iid title webUrl updatedAt project { fullPath }'
const THREAD_FIELDS =
  'id notes { nodes { id system createdAt url body author { name username avatarUrl bot } } }'

const MORE_DISCUSSIONS = `query MoreDiscussions($id: MergeRequestID!, $after: String) {
  mergeRequest(id: $id) {
    discussions(first: ${PAGE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ${THREAD_FIELDS} }
    }
  }
}`

interface RawMergeRequest {
  id: string
  iid: string
  title: string
  webUrl: string
  updatedAt: string
  project: { fullPath: string }
}

interface RawNote {
  id: string
  system: boolean
  createdAt: string
  url: string | null
  body: string
  author: {
    name: string
    username: string
    avatarUrl: string | null
    bot: boolean | null
  } | null
}

interface RawDiscussionPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: { id: string; notes: { nodes: RawNote[] } }[]
}

/** `gid://gitlab/MergeRequest/123` → 123, `gid://gitlab/Discussion/abc` → 'abc'. */
function lastSegment(gid: string): string {
  return gid.slice(gid.lastIndexOf('/') + 1)
}

function mergeRequestGid(id: number): string {
  return `gid://gitlab/MergeRequest/${id}`
}

function toRef(raw: RawMergeRequest): MergeRequestRef {
  return {
    id: Number(lastSegment(raw.id)),
    iid: Number(raw.iid),
    project: raw.project.fullPath,
    title: raw.title,
    webUrl: raw.webUrl,
    updatedAt: raw.updatedAt,
  }
}

function toDiscussion(raw: RawDiscussionPage['nodes'][number]): ActivityDiscussion {
  return {
    id: lastSegment(raw.id),
    notes: raw.notes.nodes.map((note) => ({
      id: Number(lastSegment(note.id)),
      system: note.system,
      createdAt: note.createdAt,
      url: note.url ?? '',
      body: note.body,
      author: note.author
        ? {
            name: note.author.name,
            username: note.author.username,
            avatarUrl: note.author.avatarUrl ?? null,
            bot: Boolean(note.author.bot),
          }
        : null,
    })),
  }
}

export async function fetchInvolved(
  client: GitLabClient,
  extraIds: number[],
  signal?: AbortSignal,
): Promise<Involved> {
  const extras = extraIds
    .map(
      (id) => `  m${id}: mergeRequest(id: "${mergeRequestGid(id)}") { updatedAt state }`,
    )
    .join('\n')
  const query = `query Involved {
  currentUser {
    authored: authoredMergeRequests(state: opened, first: ${PAGE}, sort: UPDATED_DESC) { nodes { ${MR_FIELDS} } }
    reviewing: reviewRequestedMergeRequests(state: opened, first: ${PAGE}, sort: UPDATED_DESC) { nodes { ${MR_FIELDS} } }
    assigned: assignedMergeRequests(state: opened, first: ${PAGE}, sort: UPDATED_DESC) { nodes { ${MR_FIELDS} } }
    todos(state: pending, type: [MERGEREQUEST], first: ${PAGE}) { nodes { target { ... on MergeRequest { ${MR_FIELDS} } } } }
  }
${extras}
}`
  const data = await client.graphql<
    {
      currentUser: {
        authored: { nodes: RawMergeRequest[] }
        reviewing: { nodes: RawMergeRequest[] }
        assigned: { nodes: RawMergeRequest[] }
        todos: { nodes: { target: Partial<RawMergeRequest> | null }[] }
      }
    } & Record<string, unknown>
  >(query, {}, signal)

  const listed = new Map<number, InvolvedMergeRequest>()
  const add = (raw: Partial<RawMergeRequest> | null | undefined, role: Role) => {
    // A todo on anything but a merge request matches no fragment and comes
    // back as an empty object.
    if (!raw?.id) return
    const ref = toRef(raw as RawMergeRequest)
    const existing = listed.get(ref.id)
    if (!existing) listed.set(ref.id, { ...ref, roles: [role] })
    else if (!existing.roles.includes(role)) existing.roles.push(role)
  }
  const user = data.currentUser
  for (const raw of user.authored.nodes) add(raw, 'author')
  for (const raw of user.reviewing.nodes) add(raw, 'reviewer')
  for (const raw of user.assigned.nodes) add(raw, 'assignee')
  for (const todo of user.todos.nodes) add(todo.target, 'mentioned')

  const extra: Involved['extra'] = {}
  for (const id of extraIds) {
    const value = data[`m${id}`] as { updatedAt: string; state: string } | null
    if (value) extra[id] = { updatedAt: value.updatedAt, state: value.state }
  }
  return { listed: [...listed.values()], extra }
}

export async function fetchActivity(
  client: GitLabClient,
  ids: number[],
  signal?: AbortSignal,
): Promise<Map<number, MergeRequestActivity>> {
  const result = new Map<number, MergeRequestActivity>()
  for (let start = 0; start < ids.length; start += BATCH) {
    const chunk = ids.slice(start, start + BATCH)
    const fields = chunk
      .map(
        (id) =>
          `  m${id}: mergeRequest(id: "${mergeRequestGid(id)}") { ${MR_FIELDS} state discussions(first: ${PAGE}) { pageInfo { hasNextPage endCursor } nodes { ${THREAD_FIELDS} } } }`,
      )
      .join('\n')
    const data = await client.graphql<
      Record<
        string,
        (RawMergeRequest & { state: string; discussions: RawDiscussionPage }) | null
      >
    >(`query Activity {\n${fields}\n}`, {}, signal)

    for (const id of chunk) {
      const raw = data[`m${id}`]
      if (!raw) continue
      // Every discussion, not the latest few: a reply lands in an existing
      // thread, which may be the oldest one on the merge request.
      const discussions = raw.discussions.nodes.map(toDiscussion)
      let pageInfo = raw.discussions.pageInfo
      while (pageInfo.hasNextPage) {
        const more = await client.graphql<{
          mergeRequest: { discussions: RawDiscussionPage } | null
        }>(
          MORE_DISCUSSIONS,
          { id: mergeRequestGid(id), after: pageInfo.endCursor },
          signal,
        )
        if (!more.mergeRequest) break
        discussions.push(...more.mergeRequest.discussions.nodes.map(toDiscussion))
        pageInfo = more.mergeRequest.discussions.pageInfo
      }
      result.set(id, { ...toRef(raw), state: raw.state, discussions })
    }
  }
  return result
}

interface RawEvent {
  created_at: string
  note?: { noteable_id: number; noteable_type: string } | null
}

export async function fetchCommentedMergeRequestIds(
  client: GitLabClient,
  since: Date,
  signal?: AbortSignal,
): Promise<number[]> {
  // `after` takes a date and is exclusive, so ask from the day before and let
  // the timestamps below make the precise cut.
  const dayBefore = new Date(since.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10)
  const events = await client.request<RawEvent[]>('GET', '/events', {
    params: {
      action: 'commented',
      target_type: 'note',
      after: dayBefore,
      per_page: '100',
    },
    signal,
  })
  const ids = new Set<number>()
  for (const event of events) {
    if (event.note?.noteable_type !== 'MergeRequest') continue
    if (Date.parse(event.created_at) < since.getTime()) continue
    ids.add(event.note.noteable_id)
  }
  return [...ids]
}
