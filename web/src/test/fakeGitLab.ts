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
  /** GitLab's systemNoteIconName, e.g. 'commit'. */
  icon?: string
  /** An inline note's GraphQL position, as GitLab sends it. */
  position?: {
    filePath: string
    newLine: number | null
    oldLine: number | null
    diffRefs: { baseSha: string | null; headSha: string | null } | null
  }
}

export interface FakeDiscussion {
  id: string
  notes: FakeNote[]
  resolvable?: boolean
  resolved?: boolean
}

export interface FakeMergeRequest {
  id: number
  iid: number
  project: string
  title: string
  updatedAt: string
  state: 'opened' | 'merged' | 'closed'
  mergedAt?: string
  discussions: FakeDiscussion[]
  /** What the queue's Facts query reports; defaults fill anything left out. */
  facts?: Partial<{
    draft: boolean
    approvalsLeft: number
    author: string
    authorBot: boolean
    reviewers: [string, string][]
    additions: number
    deletions: number
    pipeline: string
    labels: string[]
    headSha: string
    createdAt: string
    needsRebase: boolean
  }>
  /** What the MR page's MrOverview query reports. */
  overview?: Partial<{
    description: string
    shouldBeRebased: boolean
    rebaseInProgress: boolean
    canPush: boolean
    author: string
  }>
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
  const repoQueries: { query: string; variables: Record<string, string> }[] = []
  /** Repositories whose All MRs request fails (as when one is gone or forbidden). */
  const failingRepos = new Set<string>()
  const mergedQueries: { since: string }[] = []
  /** The merged list's answer: these ids, as merged (an MR merged between two reads); and a failing one. */
  const fake = { mergedOverride: null as number[] | null, failMerged: false }
  const eventQueries: Record<string, string>[] = []
  const involvedQueries: string[] = []
  const watchedQueries: string[] = []
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

  const factsNode = (id: number) => {
    const mr = mrs.get(id)!
    const f = mr.facts ?? {}
    const author = f.author ?? 'ana'
    return {
      ...mrFields(mr),
      state: mr.state,
      mergedAt: mr.mergedAt ?? null,
      createdAt: f.createdAt ?? mr.updatedAt,
      draft: f.draft ?? false,
      approved: (f.approvalsLeft ?? 1) === 0,
      approvalsLeft: f.approvalsLeft ?? 1,
      author: {
        username: author,
        name: author.toUpperCase(),
        avatarUrl: null,
        bot: f.authorBot ?? false,
      },
      reviewers: {
        nodes: (f.reviewers ?? []).map(([username, reviewState]) => ({
          username,
          name: username.toUpperCase(),
          mergeRequestInteraction: { reviewState },
        })),
      },
      diffStatsSummary: {
        additions: f.additions ?? 10,
        deletions: f.deletions ?? 2,
        fileCount: 1,
      },
      headPipeline: f.pipeline ? { status: f.pipeline } : null,
      labels: { nodes: (f.labels ?? []).map((title) => ({ title })) },
      diffHeadSha: f.headSha ?? 'sha-head',
      shouldBeRebased: f.needsRebase ?? false,
    }
  }

  server.use(
    gitlab.query('MrOverview', ({ variables }) => {
      calls.push('MrOverview')
      const mr = [...mrs.values()].find(
        (value) => value.project === variables.project && String(value.iid) === variables.iid,
      )
      if (!mr) return HttpResponse.json({ data: { project: { mergeRequest: null } } })
      const o = mr.overview ?? {}
      const author = o.author ?? 'ana'
      const person = (username: string, bot = false) => ({
        username,
        name: username.toUpperCase(),
        avatarUrl: null,
        bot,
      })
      return HttpResponse.json({
        data: {
          project: {
            mergeRequest: {
              iid: String(mr.iid),
              title: mr.title,
              description: o.description ?? 'Adds a retry budget.',
              draft: false,
              state: mr.state,
              createdAt: mr.updatedAt,
              updatedAt: mr.updatedAt,
              sourceBranch: 'feature',
              targetBranch: 'main',
              webUrl: webUrl(mr),
              diffHeadSha: 'sha-head',
              commitCount: 3,
              author: person(author),
              reviewers: {
                nodes: [
                  {
                    ...person('joao'),
                    mergeRequestInteraction: { reviewState: 'UNREVIEWED' },
                  },
                ],
              },
              approvedBy: { nodes: [] },
              approvalsRequired: 1,
              approvalsLeft: 1,
              headPipeline: { status: 'SUCCESS', path: `/${mr.project}/-/pipelines/1` },
              labels: { nodes: [{ title: 'agents', color: '#6699cc' }] },
              diffStatsSummary: { additions: 10, deletions: 2, fileCount: 1 },
              shouldBeRebased: o.shouldBeRebased ?? false,
              rebaseInProgress: o.rebaseInProgress ?? false,
              userPermissions: { pushToSourceBranch: o.canPush ?? true },
              discussions: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: mr.discussions.map((discussion) => ({
                  id: `gid://gitlab/Discussion/${discussion.id}`,
                  resolvable: Boolean(discussion.resolvable),
                  resolved: Boolean(discussion.resolved),
                  notes: {
                    nodes: discussion.notes.map((value) => ({
                      id: `gid://gitlab/Note/${value.id}`,
                      body: value.body,
                      system: value.system ?? false,
                      systemNoteIconName: value.icon ?? null,
                      createdAt: value.createdAt,
                      author: person(value.author, value.bot ?? false),
                      position: value.position ?? null,
                    })),
                  },
                })),
              },
            },
          },
        },
      })
    }),
    gitlab.query('Facts', () => {
      calls.push('Facts')
      const known = (ids: number[]) =>
        ids.filter((id) => mrs.get(id)?.state === 'opened').map(factsNode)
      return HttpResponse.json({
        data: {
          currentUser: {
            authored: { nodes: known(lists.authored) },
            reviewing: { nodes: known(lists.reviewing) },
          },
        },
      })
    }),
    gitlab.query('MergedFacts', ({ variables }) => {
      calls.push('MergedFacts')
      mergedQueries.push({ since: (variables as { since: string }).since })
      if (fake.failMerged) return HttpResponse.json({ errors: [{ message: 'unknown argument' }] }, { status: 500 })
      const merged = (ids: number[]) =>
        ids.filter((id) => mrs.get(id)?.state === 'merged').map(factsNode)
      if (fake.mergedOverride) {
        const nodes = fake.mergedOverride
          .filter((id) => mrs.has(id))
          .map((id) => ({ ...factsNode(id), state: 'merged' }))
        return HttpResponse.json({ data: { currentUser: { authored: { nodes: [] }, reviewing: { nodes } } } })
      }
      return HttpResponse.json({
        data: { currentUser: { authored: { nodes: merged(lists.authored) }, reviewing: { nodes: merged(lists.reviewing) } } },
      })
    }),
    gitlab.query('RepoMrs', ({ query, variables }) => {
      calls.push('RepoMrs')
      repoQueries.push({ query, variables: variables as Record<string, string> })
      if (Object.values(variables as Record<string, string>).some((path) => failingRepos.has(path))) {
        return HttpResponse.json({ errors: [{ message: 'forbidden' }] }, { status: 500 })
      }
      const data: Record<string, unknown> = {}
      for (const [alias, path] of Object.entries(variables as Record<string, string>)) {
        const open = [...mrs.values()].filter((mr) => mr.project === path && mr.state === 'opened')
        data[alias] = { mergeRequests: { nodes: open.map((mr) => factsNode(mr.id)) } }
      }
      return HttpResponse.json({ data })
    }),
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
              // Like GitLab: the state comes back only when the query asks for it.
              const withState = /on MergeRequest \{[^{}]*\{[^{}]*\} state \}/.test(query)
              return { target: mr ? { ...mrFields(mr), ...(withState ? { state: mr.state } : {}) } : {} }
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
    gitlab.query('Watched', ({ query }) => {
      calls.push('Watched')
      watchedQueries.push(query)
      const data: Record<string, unknown> = {}
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
    watchedQueries,
    repoQueries,
    failingRepos,
    mergedQueries,
    get mergedOverride() {
      return fake.mergedOverride
    },
    set mergedOverride(ids: number[] | null) {
      fake.mergedOverride = ids
    },
    get failMerged() {
      return fake.failMerged
    },
    set failMerged(value: boolean) {
      fake.failMerged = value
    },
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
