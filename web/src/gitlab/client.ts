import { codeForStatus, GitLabError } from './errors'

const TIMEOUT_MS = 30_000

export interface RequestOptions {
  json?: unknown
  params?: Record<string, string>
  signal?: AbortSignal
}

export class GitLabClient {
  private readonly apiBase: string
  private readonly graphqlUrl: string
  private readonly token: string

  constructor(apiBase: string, token: string) {
    this.apiBase = apiBase.replace(/\/+$/, '')
    // REST lives at /api/v4 and GraphQL beside it at /api/graphql.
    this.graphqlUrl = this.apiBase.replace(/\/v4$/, '/graphql')
    this.token = token
  }

  private url(path: string, params?: Record<string, string>): string {
    const url = new URL(`${this.apiBase}${path}`)
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }

  private async send(
    method: string,
    url: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'PRIVATE-TOKEN': this.token,
    }
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout
    try {
      return await fetch(url, {
        method,
        headers,
        body:
          options.json === undefined ? undefined : JSON.stringify(options.json),
        signal,
      })
    } catch (error) {
      if (timeout.aborted) {
        throw new GitLabError(504, 'GitLab request timed out', 'gitlab_timeout')
      }
      if (options.signal?.aborted) throw error
      throw new GitLabError(502, 'Could not reach GitLab', 'gitlab_unavailable')
    }
  }

  private static async raiseForError(response: Response): Promise<void> {
    if (response.ok) return
    const text = await response.text()
    let message = text
    try {
      const payload = JSON.parse(text) as unknown
      if (payload && typeof payload === 'object' && 'message' in payload) {
        const value = (payload as { message: unknown }).message
        message = typeof value === 'string' ? value : JSON.stringify(value)
      } else if (payload !== null && typeof payload !== 'object') {
        message = String(payload)
      }
    } catch {
      // Not JSON; the raw body is the message.
    }
    throw new GitLabError(
      response.status,
      message,
      codeForStatus(response.status),
    )
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.send(
      method,
      this.url(path, options.params),
      options,
    )
    await GitLabClient.raiseForError(response)
    return (await response.json()) as T
  }

  async paginate<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const results: T[] = []
    let page = 1
    for (;;) {
      const response = await this.send(
        'GET',
        this.url(path, { page: String(page), per_page: '100' }),
        { signal },
      )
      await GitLabClient.raiseForError(response)
      results.push(...((await response.json()) as T[]))
      const next = response.headers.get('x-next-page')
      if (!next) return results
      page = Number(next)
    }
  }

  /**
   * One GraphQL request. GitLab answers a failed query with 200 and an
   * `errors` array, so a query error is raised here rather than surfacing as
   * missing data somewhere further down.
   */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.send('POST', this.graphqlUrl, {
      json: { query, variables },
      signal,
    })
    await GitLabClient.raiseForError(response)
    const payload = (await response.json()) as {
      data?: T
      errors?: { message: string }[]
    }
    if (payload.errors?.length) {
      throw new GitLabError(
        502,
        payload.errors.map((error) => error.message).join('; '),
        'gitlab_graphql_error',
      )
    }
    if (payload.data === undefined) {
      throw new GitLabError(
        502,
        'GitLab returned no GraphQL data',
        'gitlab_graphql_error',
      )
    }
    return payload.data
  }
}
