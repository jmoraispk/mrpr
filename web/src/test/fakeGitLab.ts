/**
 * A fake of the GitLab endpoints the inbox reads, served through the global
 * msw server. Call `createFakeGitLab()` inside a test (after `setup.ts` has
 * reset handlers) and mutate the returned state between polls. `calls` logs
 * every request by operation name, so a test can assert exactly what a poll
 * cost.
 */
import { graphql, http, HttpResponse } from 'msw'

import { server } from './server'

export const HOST = 'gitlab.example.com'
export const API = `https://${HOST}/api/v4`
export const GRAPHQL = `https://${HOST}/api/graphql`

export interface FakeNote {
  id: number
  author: string
  body: string
  createdAt: string
  system?: boolean
  bot?: boolean
}

export interface FakeDiscussion {
  id: string
  notes: FakeNote[]
}

export interface FakeMergeRequest {
  id: number
  iid: number
  project: string
  title: string
  updatedAt: string
  state: 'opened' | 'merged' | 'closed'
  discussions: FakeDiscussion[]
}

export function fakeMergeRequest(
  id: number,
  overrides: Partial<FakeMergeRequest> = {},
): FakeMergeRequest {
  return {
    id,
    iid: id,
    project: 'g/p',
    title: `MR ${id}`,
    updatedAt: '2026-09-20T10:00:00.000Z',
    state: 'opened',
    discussions: [],
    ...overrides,
  }
}

export function fakeNote(
  id: number,
  author: string,
  body: string,
  createdAt: string,
  extra: Partial<FakeNote> = {},
): FakeNote {
  return { id, author, body, createdAt, ...extra }
}

export function createFakeGitLab() {
  const mrs = new Map<number, FakeMergeRequest>()
  const lists = {
    authored: [] as number[],
    reviewing: [] as number[],
    assigned: [] as number[],
    /** A number is a merge request todo; 'issue' is a todo on something else. */
    todos: [] as (number | 'issue')[],
  }
  const events: { noteableId: number; createdAt: string; type?: string }[] = []
  const calls: string[] = []
  const eventQueries: Record<string, string>[] = []
  const involvedQueries: string[] = []
  let pageSize = 100
  let gate: Promise<void> | null = null

  const webUrl = (mr: FakeMergeRequest) =>
    `https://${HOST}/${mr.project}/-/merge_requests/${mr.iid}`
  const mrFields = (mr: FakeMergeRequest) => ({
    id: `gid://gitlab/MergeRequest/${mr.id}`,
    iid: String(mr.iid),
    title: mr.title,
    webUrl: webUrl(mr),
    updatedAt: mr.updatedAt,
    project: { fullPath: mr.project },
  })
  const note = (mr: FakeMergeRequest, value: FakeNote) => ({
    id: `gid://gitlab/Note/${value.id}`,
    system: value.system ?? false,
    createdAt: value.createdAt,
    url: `${webUrl(mr)}#note_${value.id}`,
    body: value.body,
    author: {
      name: value.author.toUpperCase(),
      username: value.author,
      avatarUrl: `/uploads/${value.author}.png`,
      bot: value.bot ?? false,
    },
  })
  const page = (mr: FakeMergeRequest, offset: number) => {
    const slice = mr.discussions.slice(offset, offset + pageSize)
    const end = offset + slice.length
    return {
      pageInfo: {
        hasNextPage: end < mr.discussions.length,
        endCursor: String(end),
      },
      nodes: slice.map((discussion) => ({
        id: `gid://gitlab/Discussion/${discussion.id}`,
        notes: { nodes: discussion.notes.map((value) => note(mr, value)) },
      })),
    }
  }
  const aliases = (query: string) =>
    [...query.matchAll(/m(\d+): mergeRequest/g)].map((match) =>
      Number(match[1]),
    )
  const nodes = (ids: number[]) => ({
    nodes: ids
      .map((id) => mrs.get(id))
      .filter((mr): mr is FakeMergeRequest => mr !== undefined)
      .map(mrFields),
  })
  const gitlab = graphql.link(GRAPHQL)

  server.use(
    gitlab.query('Involved', async ({ query }) => {
      calls.push('Involved')
      involvedQueries.push(query)
      if (gate) await gate
      const data: Record<string, unknown> = {
        currentUser: {
          authored: nodes(lists.authored),
          reviewing: nodes(lists.reviewing),
          assigned: nodes(lists.assigned),
          todos: {
            nodes: lists.todos.map((entry) => {
              const mr = entry === 'issue' ? undefined : mrs.get(entry)
              return { target: mr ? mrFields(mr) : {} }
            }),
          },
        },
      }
      for (const id of aliases(query)) {
        const mr = mrs.get(id)
        data[`m${id}`] = mr ? { updatedAt: mr.updatedAt, state: mr.state } : null
      }
      return HttpResponse.json({ data })
    }),
    gitlab.query('Activity', ({ query }) => {
      calls.push('Activity')
      const data: Record<string, unknown> = {}
      for (const id of aliases(query)) {
        const mr = mrs.get(id)
        data[`m${id}`] = mr
          ? { ...mrFields(mr), state: mr.state, discussions: page(mr, 0) }
          : null
      }
      return HttpResponse.json({ data })
    }),
    gitlab.query('MoreDiscussions', ({ variables }) => {
      calls.push('MoreDiscussions')
      const id = Number(String(variables.id).split('/').pop())
      const mr = mrs.get(id)
      return HttpResponse.json({
        data: {
          mergeRequest: mr
            ? { discussions: page(mr, Number(variables.after)) }
            : null,
        },
      })
    }),
    http.get(`${API}/events`, ({ request }) => {
      calls.push('events')
      eventQueries.push(Object.fromEntries(new URL(request.url).searchParams))
      return HttpResponse.json(
        events.map((event, index) => ({
          id: index + 1,
          created_at: event.createdAt,
          note: {
            noteable_id: event.noteableId,
            noteable_type: event.type ?? 'MergeRequest',
          },
        })),
      )
    }),
  )

  return {
    mrs,
    lists,
    events,
    calls,
    eventQueries,
    involvedQueries,
    add(mr: FakeMergeRequest) {
      mrs.set(mr.id, mr)
      return mr
    },
    setPageSize(size: number) {
      pageSize = size
    },
    /** Holds every `Involved` request until the returned function is called. */
    hold(): () => void {
      let release!: () => void
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        gate = null
        release()
      }
    },
  }
}
