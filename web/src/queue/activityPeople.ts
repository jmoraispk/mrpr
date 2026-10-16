import type { OverviewDiscussion } from '../gitlab/mrOverview'

/** Someone who commented on the MR, and how many times. */
export interface Person {
  username: string
  name: string
  count: number
}

/**
 * Comments, unresolved threads, who wrote how many (most first), and the
 * newest note. Bots and system notes are not people.
 */
export function activityStats(discussions: OverviewDiscussion[]): {
  comments: number
  unresolved: number
  people: Person[]
  last: string | null
} {
  const counts = new Map<string, Person>()
  let comments = 0
  let unresolved = 0
  let last: string | null = null
  for (const discussion of discussions) {
    if (discussion.resolvable && !discussion.resolved) unresolved += 1
    for (const note of discussion.notes) {
      if (!last || Date.parse(note.createdAt) > Date.parse(last)) last = note.createdAt
      if (note.system || !note.author || note.author.bot) continue
      comments += 1
      const seen = counts.get(note.author.username) ?? {
        username: note.author.username,
        name: note.author.name,
        count: 0,
      }
      seen.count += 1
      counts.set(seen.username, seen)
    }
  }
  const people = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return { comments, unresolved, people, last }
}
