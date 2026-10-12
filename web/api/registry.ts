import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

import { lookup, save, type RegistryEntry, type RegistryStore } from '../src/registry/core.ts'

// The Vercel Marketplace integration names these KV_REST_API_*; a manual
// Upstash setup names them UPSTASH_REDIS_REST_*. Accept either.
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? '',
  automaticDeserialization: false,
})

const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  prefix: 'mrpr-registry-writes',
})

// Atomic compare-and-swap: overwrite only if the stored clientId is expected.
const REPLACE_IF = `
local current = redis.call('GET', KEYS[1])
if current and cjson.decode(current).clientId == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0`

const store: RegistryStore = {
  async get(key) {
    const raw = await redis.get<string>(key)
    return raw ? (JSON.parse(raw) as RegistryEntry) : null
  },
  async setIfAbsent(key, value) {
    return (await redis.set(key, JSON.stringify(value), { nx: true })) === 'OK'
  },
  async replaceIf(key, expected, value) {
    return (await redis.eval(REPLACE_IF, [key], [expected, JSON.stringify(value)])) === 1
  },
}

function reply(status: number, body: unknown, cacheable = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': cacheable ? 'public, s-maxage=300' : 'no-store',
    },
  })
}

export async function GET(request: Request): Promise<Response> {
  const host = new URL(request.url).searchParams.get('host') ?? ''
  const result = await lookup(store, host)
  return reply(result.status, result.body, result.status === 200)
}

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!(await limiter.limit(ip)).success) return reply(429, { error: 'rate_limited' })
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return reply(400, { error: 'bad_json' })
  }
  const result = await save(store, input, new Date())
  return reply(result.status, result.body)
}
