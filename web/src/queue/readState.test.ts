import { expect, test } from 'vitest'

import type { InboxItem } from '../inbox/types'
import type { QueueRow } from './model'
import { focusNoteOf, latestWaiting } from './readState'

function item(noteId: number, createdAt: string, kind: InboxItem['kind'] = 'reply'): InboxItem {
  return {
    id: `h:${noteId}`, kind, hostId: 'h', mrId: 1, project: 'g/p', iid: 1, mrTitle: '',
    discussionId: `d${noteId}`, noteId, author: null, excerpt: '', createdAt, webUrl: '', read: false,
  }
}
const row = (items: InboxItem[]) => ({ items }) as unknown as QueueRow

test('the newest waiting thread wins, whatever order the items arrive in', () => {
  const older = item(1, '2026-10-11T08:00:00Z')
  const newer = item(2, '2026-10-11T09:00:00Z')
  expect(latestWaiting(row([newer, older]))?.noteId).toBe(2)
  expect(latestWaiting(row([older, newer]))?.noteId).toBe(2)
  expect(focusNoteOf(row([newer, older]))).toBe(2)
})

test('a thread waiting on you beats a newer plain comment', () => {
  const reply = item(1, '2026-10-11T08:00:00Z')
  const comment = item(2, '2026-10-11T09:00:00Z', 'comment')
  expect(focusNoteOf(row([comment, reply]))).toBe(1)
})
