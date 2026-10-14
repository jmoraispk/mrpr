// The newest feedback, newest first: `npm run feedback` (20) or `npm run feedback -- 50`.
// Credentials come from web/.env.local (`vercel env pull .env.local`) or the
// environment. They are never printed.
import { Redis } from '@upstash/redis'

try {
  process.loadEnvFile(new URL('../.env.local', import.meta.url))
} catch {
  // No .env.local: the environment may already hold the credentials.
}
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
if (!url || !token) {
  console.error('No Upstash credentials. In web/, run `vercel env pull .env.local` first.')
  process.exit(1)
}
const count = Math.max(1, Number(process.argv[2]) || 20)
const redis = new Redis({ url, token, automaticDeserialization: false })
const entries = await redis.lrange('feedback', 0, count - 1)
if (!entries.length) console.log('No feedback yet.')
for (const raw of entries) {
  const entry = JSON.parse(raw)
  const who = entry.email ? ` · ${entry.email}` : ''
  console.log(`— ${entry.at}${who} · ${entry.version} · ${entry.browser}\n${entry.message}\n`)
}
