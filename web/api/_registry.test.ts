import { beforeEach, expect, test, vi } from 'vitest'

/** In-memory Redis: just what the function calls. */
const redis = vi.hoisted(() => {
  const data = new Map<string, string>()
  return {
    data,
    allowed: true,
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, options?: { nx?: boolean }) => {
      if (options?.nx && data.has(key)) return null
      data.set(key, value)
      return 'OK'
    }),
  }
})
vi.mock('@upstash/redis', () => ({
  Redis: class {
    get = redis.get
    set = redis.set
  },
}))
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {}
    }
    limit = async () => ({ success: redis.allowed })
  },
}))

const { GET, POST } = await import('./registry.ts')

const ID = 'a'.repeat(64)
const url = (query = '') => `https://mrpr.example/api/registry${query}`
const post = (body: string, type = 'application/json') =>
  POST(new Request(url(), { method: 'POST', body, headers: { 'content-type': type } }))

beforeEach(() => {
  redis.data.clear()
  redis.allowed = true
})

test('a lookup answers 404 until an id is saved, then the id, cacheably', async () => {
  const unknown = await GET(new Request(url('?host=gitlab.example.com')))
  expect(unknown.status).toBe(404)
  expect(unknown.headers.get('cache-control')).toBe('no-store')

  const saved = await post(JSON.stringify({ host: 'gitlab.example.com', clientId: ID }))
  expect(saved.status).toBe(200)
  expect(await saved.json()).toEqual({ clientId: ID })

  const known = await GET(new Request(url('?host=gitlab.example.com')))
  expect(await known.json()).toEqual({ clientId: ID })
  expect(known.headers.get('cache-control')).toBe('public, s-maxage=300')
})

test('a second id for the same server does not replace the first', async () => {
  await post(JSON.stringify({ host: 'gitlab.example.com', clientId: ID }))
  const second = await post(
    JSON.stringify({ host: 'gitlab.example.com', clientId: 'b'.repeat(64), replaces: ID }),
  )
  expect(await second.json()).toEqual({ clientId: ID })
})

test('only JSON bodies are accepted, so other sites cannot post through visitors', async () => {
  // A cross-site form or text/plain fetch needs no preflight; JSON does.
  const response = await post(JSON.stringify({ host: 'gitlab.example.com', clientId: ID }), 'text/plain')
  expect(response.status).toBe(415)
  expect(redis.data.size).toBe(0)
})

test('malformed JSON is a 400', async () => {
  expect((await post('{not json')).status).toBe(400)
})

test('too many writes from one address are refused', async () => {
  redis.allowed = false
  const response = await post(JSON.stringify({ host: 'gitlab.example.com', clientId: ID }))
  expect(response.status).toBe(429)
  expect(redis.data.size).toBe(0)
})
