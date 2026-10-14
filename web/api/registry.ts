import { limiter, readJson, redis, reply } from './_http.js'
import { lookup, save, type RegistryEntry, type RegistryStore } from './_registry-core.js'

const writes = limiter('mrpr-registry-writes', 10)

const store: RegistryStore = {
  async get(key) {
    const raw = await redis.get<string>(key)
    return raw ? (JSON.parse(raw) as RegistryEntry) : null
  },
  async setIfAbsent(key, value) {
    return (await redis.set(key, JSON.stringify(value), { nx: true })) === 'OK'
  },
}

export async function GET(request: Request): Promise<Response> {
  const host = new URL(request.url).searchParams.get('host') ?? ''
  const result = await lookup(store, host)
  return reply(result.status, result.body, result.status === 200)
}

export async function POST(request: Request): Promise<Response> {
  const read = await readJson(request, writes)
  if ('refused' in read) return read.refused
  const result = await save(store, read.input, new Date())
  return reply(result.status, result.body)
}
