import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// The Vercel Marketplace integration names these KV_REST_API_*; a manual
// Upstash setup names them UPSTASH_REDIS_REST_*. Accept either.
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? '',
  automaticDeserialization: false,
})

export function limiter(prefix: string, perHour: number): Ratelimit {
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(perHour, '1 h'), prefix })
}

export function reply(status: number, body: unknown, cacheable = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': cacheable ? 'public, s-maxage=300' : 'no-store',
    },
  })
}

/** The JSON body of a write, or the reply that refuses it. */
export async function readJson(
  request: Request,
  limit: Ratelimit,
): Promise<{ input: unknown } | { refused: Response }> {
  // Requiring JSON forces a CORS preflight on cross-site requests, which these
  // functions never answer, so other sites cannot write through visitors.
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return { refused: reply(415, { error: 'json_only' }) }
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!(await limit.limit(ip)).success) return { refused: reply(429, { error: 'rate_limited' }) }
  try {
    return { input: await request.json() }
  } catch {
    return { refused: reply(400, { error: 'bad_json' }) }
  }
}
