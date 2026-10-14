import { limiter, readJson, redis, reply } from './_http.js'
import { saveFeedback, type FeedbackStore } from './_feedback-core.js'

const writes = limiter('mrpr-feedback', 10)
const store: FeedbackStore = {
  async push(key, value) {
    await redis.lpush(key, value)
  },
}

export async function POST(request: Request): Promise<Response> {
  const read = await readJson(request, writes)
  if ('refused' in read) return read.refused
  const result = await saveFeedback(store, read.input, new Date())
  return reply(result.status, result.body)
}
