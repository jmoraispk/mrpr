import { limiter, readJson, redis, reply } from './_http.js'
import { recordUser, type UserStore } from './_users-core.js'

const writes = limiter('mrpr-users', 30)
const store: UserStore = {
  async setIfAbsent(key, value) {
    return (await redis.set(key, value, { nx: true })) === 'OK'
  },
  get: (key) => redis.get<string>(key),
}

export async function POST(request: Request): Promise<Response> {
  const read = await readJson(request, writes)
  if ('refused' in read) return read.refused
  const result = await recordUser(store, read.input, new Date())
  return reply(result.status, result.body)
}
