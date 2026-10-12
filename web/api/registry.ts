import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

import { lookup, save, type RegistryEntry, type RegistryStore } from './_registry-core.js'

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

const store: RegistryStore = {
  async get(key) {
    const raw = await redis.get<string>(key)
    return raw ? (JSON.parse(raw) as RegistryEntry) : null
  },
  async setIfAbsent(key, value) {
    return (await redis.set(key, JSON.stringify(value), { nx: true })) === 'OK'
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
  // Requiring JSON forces a CORS preflight on cross-site requests, which this
  // function never answers, so other sites cannot write through visitors.
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return reply(415, { error: 'json_only' })
  }
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
