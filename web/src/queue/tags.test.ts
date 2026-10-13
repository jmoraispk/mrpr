import { expect, test } from 'vitest'

import { attentionOf, orderTags, tagText, visibleTags, type Tag } from './tags'

test('tags in words', () => {
  expect(tagText({ kind: 'blocking', people: 1 })).toBe('Blocking 1 person')
  expect(tagText({ kind: 'blocking', people: 3 })).toBe('Blocking 3 people')
  expect(tagText({ kind: 'needs-review' })).toBe('Needs your review')
  expect(tagText({ kind: 'reply-waiting', count: 1 })).toBe('Reply waiting')
  expect(tagText({ kind: 'reply-waiting', count: 2 })).toBe('2 replies waiting')
  expect(tagText({ kind: 'new-commits', count: 1 })).toBe('1 new commit')
  expect(tagText({ kind: 'new-commits', count: 4 })).toBe('4 new commits')
  expect(tagText({ kind: 'changes-addressed' })).toBe('Changes addressed')
  expect(tagText({ kind: 'returned' })).toBe('Returned to you')
  expect(tagText({ kind: 'waiting-on', names: ['John', 'Li'], days: 2 })).toBe('Waiting on John, Li · 2d')
  expect(tagText({ kind: 'waiting-on', names: [], days: 0 })).toBe('Waiting on approvals')
  expect(tagText({ kind: 'quick-win', minutes: 1 })).toBe('Quick win · ~1 min')
  expect(tagText({ kind: 'pipeline-failed' })).toBe('Pipeline failed')
  expect(tagText({ kind: 'needs-rebase' })).toBe('Needs rebase')
  expect(tagText({ kind: 'draft' })).toBe('Draft')
  expect(tagText({ kind: 'ai-authored' })).toBe('AI-authored')
})

const tags: Tag[] = [
  { kind: 'draft' },
  { kind: 'needs-review' },
  { kind: 'new-commits', count: 2 },
  { kind: 'quick-win', minutes: 1 },
  { kind: 'ai-authored' },
]

test('tags you chose come first, then the default priority', () => {
  expect(orderTags(tags, []).map((tag) => tag.kind)).toEqual([
    'new-commits',
    'needs-review',
    'quick-win',
    'draft',
    'ai-authored',
  ])
  expect(orderTags(tags, ['draft', 'quick-win']).map((tag) => tag.kind)).toEqual([
    'draft',
    'quick-win',
    'new-commits',
    'needs-review',
    'ai-authored',
  ])
})

test('Needs your review is not repeated beside Blocking', () => {
  const both: Tag[] = [{ kind: 'needs-review' }, { kind: 'blocking', people: 2 }]
  expect(orderTags(both, []).map((tag) => tag.kind)).toEqual(['blocking'])
  expect(orderTags(both, ['needs-review']).map((tag) => tag.kind)).toEqual(['blocking'])
})

test('three tags, then a count of the rest', () => {
  const { shown, more } = visibleTags(tags, [], 3)
  expect(shown.map((tag) => tag.kind)).toEqual(['new-commits', 'needs-review', 'quick-win'])
  expect(more).toBe(2)
  expect(visibleTags([{ kind: 'draft' }], [], 3)).toEqual({ shown: [{ kind: 'draft' }], more: 0 })
})

test('attention: needs you, returned, waiting, done', () => {
  expect(attentionOf([{ kind: 'reply-waiting', count: 1 }, { kind: 'returned' }])).toBe('needs-you')
  expect(attentionOf([{ kind: 'blocking', people: 1 }])).toBe('needs-you')
  expect(attentionOf([{ kind: 'new-commits', count: 1 }])).toBe('returned')
  expect(attentionOf([{ kind: 'returned' }, { kind: 'waiting-on', names: [], days: 0 }])).toBe(
    'returned',
  )
  expect(attentionOf([{ kind: 'waiting-on', names: ['John'], days: 1 }])).toBe('waiting')
  expect(attentionOf([{ kind: 'draft' }, { kind: 'quick-win', minutes: 1 }])).toBe('done')
})
