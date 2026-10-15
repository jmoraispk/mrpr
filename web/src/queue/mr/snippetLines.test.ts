import { expect, test } from 'vitest'

import { snippetAt } from './snippetLines'

const DIFF = [
  '@@ -10,6 +10,7 @@ def retry():',
  ' a = 1',
  ' b = 2',
  '-c = 3',
  '+c = 4',
  '+d = 5',
  ' e = 6',
  ' f = 7',
  '@@ -40,2 +41,2 @@',
  ' x = 1',
  '-y = 2',
  '+y = 3',
].join('\n')

test('the commented new line, with up to three lines above it from its hunk', () => {
  expect(snippetAt(DIFF, { newLine: 13, oldLine: null })).toEqual([
    { kind: 'ctx', oldLine: 11, newLine: 11, text: 'b = 2', target: false },
    { kind: 'del', oldLine: 12, newLine: null, text: 'c = 3', target: false },
    { kind: 'add', oldLine: null, newLine: 12, text: 'c = 4', target: false },
    { kind: 'add', oldLine: null, newLine: 13, text: 'd = 5', target: true },
  ])
})

test('a comment on a removed line finds it by its old number; the hunk start bounds the context', () => {
  expect(snippetAt(DIFF, { newLine: null, oldLine: 41 })).toEqual([
    { kind: 'ctx', oldLine: 40, newLine: 41, text: 'x = 1', target: false },
    { kind: 'del', oldLine: 41, newLine: null, text: 'y = 2', target: true },
  ])
})

test('a line outside every hunk, or an empty diff, has no snippet', () => {
  expect(snippetAt(DIFF, { newLine: 99, oldLine: null })).toBeNull()
  expect(snippetAt('', { newLine: 1, oldLine: null })).toBeNull()
})
