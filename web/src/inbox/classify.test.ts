import { expect, test } from 'vitest'

import type {
  ActivityDiscussion,
  ActivityNote,
  MergeRequestActivity,
  Role,
} from '../gitlab/activity'
import {
  classify,
  excerpt,
  reviewRequestedItem,
  type ClassifyInput,
} from './classify'

const HOST = 'gitlab.example.com'
const T0 = '2026-09-23T10:00:00.000Z'
const MR_URL = 'https://gitlab.example.com/g/p/-/merge_requests/1'

function note(
  id: number,
  username: string,
  body: string,
  extra: Partial<ActivityNote> = {},
): ActivityNote {
  return {
    id,
    system: false,
    createdAt: T0,
    url: `${MR_URL}#note_${id}`,
    body,
    author: {
      name: username.toUpperCase(),
      username,
      avatarUrl: `/uploads/${username}.png`,
      bot: false,
    },
    ...extra,
  }
}

function system(id: number, username: string, body: string): ActivityNote {
  return note(id, username, body, { system: true })
}

function mr(discussions: ActivityDiscussion[]): MergeRequestActivity {
  return {
    id: 100,
    iid: 1,
    project: 'g/p',
    title: 'Parser',
    webUrl: MR_URL,
    updatedAt: T0,
    state: 'opened',
    discussions,
  }
}

function run(
  discussions: ActivityDiscussion[],
  roles: Role[],
  overrides: Partial<ClassifyInput> = {},
) {
  return classify({
    hostId: HOST,
    username: 'joao',
    mr: mr(discussions),
    roles,
    isNew: () => true,
    hideBots: true,
    ...overrides,
  })
}

const kinds = (items: ReturnType<typeof classify>) =>
  items.map((item) => [item.kind, item.noteId])

test('a comment on your merge request is a full item', () => {
  expect(run([{ id: 'd1', notes: [note(1, 'ana', 'Why?')] }], ['author'])).toEqual([
    {
      id: 'gitlab.example.com:1',
      kind: 'comment',
      hostId: HOST,
      mrId: 100,
      project: 'g/p',
      iid: 1,
      mrTitle: 'Parser',
      discussionId: 'd1',
      noteId: 1,
      author: {
        name: 'ANA',
        username: 'ana',
        avatarUrl: 'https://gitlab.example.com/uploads/ana.png',
      },
      excerpt: 'Why?',
      createdAt: T0,
      webUrl: `${MR_URL}#note_1`,
      read: false,
    },
  ])
})

test('a reply in a thread you posted in counts, but only after you posted', () => {
  const thread = {
    id: 'd1',
    notes: [note(1, 'ana', 'Q'), note(2, 'joao', 'A'), note(3, 'ana', 'Thanks')],
  }
  expect(kinds(run([thread], ['reviewer']))).toEqual([['reply', 3]])
})

test('a mention anywhere is a mention, and look-alikes are not', () => {
  const items = run(
    [
      { id: 'd1', notes: [note(1, 'ana', 'cc @joao please')] },
      { id: 'd2', notes: [note(2, 'ana', '@joaom is a different person')] },
      { id: 'd3', notes: [note(3, 'ana', 'mail x@joao.com')] },
      { id: 'd4', notes: [note(4, 'ana', 'thanks @JOAO.')] },
    ],
    ['reviewer'],
  )
  expect(kinds(items)).toEqual([
    ['mention', 1],
    ['mention', 4],
  ])
})

test('one note yields one item, by the order reply, mention, comment', () => {
  const replyAndMention = {
    id: 'd1',
    notes: [note(1, 'joao', 'Q'), note(2, 'ana', '@joao answered')],
  }
  const mentionOnOwn = { id: 'd2', notes: [note(3, 'ana', '@joao look')] }
  expect(kinds(run([replyAndMention, mentionOnOwn], ['author']))).toEqual([
    ['reply', 2],
    ['mention', 3],
  ])
})

test('your own notes are never items', () => {
  expect(run([{ id: 'd1', notes: [note(1, 'joao', 'Mine')] }], ['author'])).toEqual([])
})

test('threads you never joined on other people’s merge requests are ignored', () => {
  expect(
    run([{ id: 'd1', notes: [note(1, 'ana', 'Q'), note(2, 'bo', 'A')] }], ['reviewer']),
  ).toEqual([])
})

test('bot notes are hidden unless the setting says otherwise', () => {
  const discussions = [
    { id: 'd1', notes: [note(1, 'coderabbit', 'Walkthrough', { author: { name: 'CR', username: 'coderabbit', avatarUrl: null, bot: true } })] },
  ]
  expect(run(discussions, ['author'])).toEqual([])
  expect(kinds(run(discussions, ['author'], { hideBots: false }))).toEqual([
    ['comment', 1],
  ])
})

test('system notes other than merged, approved and closed are dropped', () => {
  const discussions = [
    { id: 's1', notes: [system(1, 'ana', 'changed the description')] },
    { id: 's2', notes: [system(2, 'ana', 'added 1 commit\n\n<ul><li>abc</li></ul>')] },
    { id: 's3', notes: [system(3, 'ana', 'resolved all threads')] },
  ]
  expect(run(discussions, ['author'])).toEqual([])
})

test('state changes on your merge request become state items', () => {
  const items = run(
    [
      { id: 's1', notes: [system(1, 'ana', 'approved this merge request')] },
      { id: 's2', notes: [system(2, 'ana', 'merged')] },
      { id: 's3', notes: [system(3, 'bo', 'closed')] },
    ],
    ['author'],
  )
  expect(kinds(items)).toEqual([
    ['approved', null],
    ['merged', null],
    ['closed', null],
  ])
  expect(items[0]).toMatchObject({
    id: 'gitlab.example.com:1',
    discussionId: null,
    excerpt: '',
    webUrl: `${MR_URL}#note_1`,
  })
})

test('on a merge request you review, only the merge is news', () => {
  const items = run(
    [
      { id: 's1', notes: [system(1, 'ana', 'approved this merge request')] },
      { id: 's2', notes: [system(2, 'ana', 'merged')] },
      { id: 's3', notes: [system(3, 'ana', 'closed')] },
    ],
    ['reviewer'],
  )
  expect(kinds(items)).toEqual([['merged', null]])
})

test('only new notes are classified', () => {
  const items = run(
    [{ id: 'd1', notes: [note(1, 'ana', 'old'), note(2, 'ana', 'new')] }],
    ['author'],
    { isNew: (value) => value.id > 1 },
  )
  expect(kinds(items)).toEqual([['comment', 2]])
})

test('an excerpt drops hidden markup and stops at 140 characters', () => {
  expect(excerpt('<!-- bot marker -->\n\n**Fix**   the <b>thing</b>')).toBe(
    '**Fix** the thing',
  )
  const long = excerpt('word '.repeat(60))
  expect(long.length).toBeLessThanOrEqual(140)
  expect(long.endsWith('…')).toBe(true)
})

test('a review request is an item without a note', () => {
  expect(
    reviewRequestedItem(HOST, {
      id: 100,
      iid: 1,
      project: 'g/p',
      title: 'Parser',
      webUrl: MR_URL,
      updatedAt: T0,
    }),
  ).toEqual({
    id: 'gitlab.example.com:review:100',
    kind: 'review_requested',
    hostId: HOST,
    mrId: 100,
    project: 'g/p',
    iid: 1,
    mrTitle: 'Parser',
    discussionId: null,
    noteId: null,
    author: null,
    excerpt: '',
    createdAt: T0,
    webUrl: MR_URL,
    read: false,
  })
})
