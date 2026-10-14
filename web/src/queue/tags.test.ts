import { expect, test } from 'vitest'

import { attentionOf, orderTags, tagText, visibleTags, type Tag } from './tags'

test('labels in words', () => {
  expect(tagText({ kind: 'blocking', people: 1 })).toBe('Blocking 1 person')
  expect(tagText({ kind: 'blocking', people: 3 })).toBe('Blocking 3 people')
  expect(tagText({ kind: 'waiting-on-you' })).toBe('Waiting on you')
  expect(tagText({ kind: 'changes-addressed' })).toBe('Changes addressed')
  expect(tagText({ kind: 'returned' })).toBe('Returned to you')
  expect(tagText({ kind: 'quick-win', minutes: 1 })).toBe('Quick win · ~1 min')
  expect(tagText({ kind: 'waiting-on-others', days: 0 })).toBe('Waiting on others')
  expect(tagText({ kind: 'waiting-on-others', days: 2 })).toBe('Waiting on others · 2d')
  expect(tagText({ kind: 'needs-rebase' })).toBe('Needs rebase')
})

const tags: Tag[] = [
  { kind: 'needs-rebase' },
  { kind: 'waiting-on-you' },
  { kind: 'quick-win', minutes: 1 },
  { kind: 'returned' },
  { kind: 'waiting-on-others', days: 1 },
]

test('labels you chose come first, then the default priority', () => {
  expect(orderTags(tags, []).map((tag) => tag.kind)).toEqual([
    'waiting-on-you',
    'returned',
    'quick-win',
    'waiting-on-others',
    'needs-rebase',
  ])
  expect(orderTags(tags, ['needs-rebase', 'quick-win']).map((tag) => tag.kind)).toEqual([
    'needs-rebase',
    'quick-win',
    'waiting-on-you',
    'returned',
    'waiting-on-others',
  ])
})

test('Waiting on you is not repeated beside Blocking', () => {
  const both: Tag[] = [{ kind: 'waiting-on-you' }, { kind: 'blocking', people: 2 }]
  expect(orderTags(both, []).map((tag) => tag.kind)).toEqual(['blocking'])
  expect(orderTags(both, ['waiting-on-you']).map((tag) => tag.kind)).toEqual(['blocking'])
})

test('three labels, then a count of the rest', () => {
  const { shown, more } = visibleTags(tags, [], 3)
  expect(shown.map((tag) => tag.kind)).toEqual(['waiting-on-you', 'returned', 'quick-win'])
  expect(more).toBe(2)
})

test('attention: needs you, returned, waiting, done', () => {
  expect(attentionOf([{ kind: 'waiting-on-you' }, { kind: 'returned' }])).toBe('needs-you')
  expect(attentionOf([{ kind: 'blocking', people: 1 }])).toBe('needs-you')
  expect(attentionOf([{ kind: 'changes-addressed' }])).toBe('returned')
  expect(attentionOf([{ kind: 'returned' }, { kind: 'waiting-on-others', days: 0 }])).toBe('returned')
  expect(attentionOf([{ kind: 'waiting-on-others', days: 1 }])).toBe('waiting')
  expect(attentionOf([{ kind: 'needs-rebase' }, { kind: 'quick-win', minutes: 1 }])).toBe('done')
})
