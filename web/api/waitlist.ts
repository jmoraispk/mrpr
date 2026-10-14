import { limiter, readJson, redis, reply } from './_http.js'
import { joinWaitlist, type WaitlistStore } from './_waitlist-core.js'

const writes = limiter('mrpr-waitlist', 30)
const store: WaitlistStore = {
  async add(key, member) {
    await redis.sadd(key, member)
  },
}

export async function POST(request: Request): Promise<Response> {
  const read = await readJson(request, writes)
  if ('refused' in read) return read.refused
  const result = await joinWaitlist(store, read.input)
  return reply(result.status, result.body)
}
