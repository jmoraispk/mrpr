import { expect, test } from 'vitest'

import { toMarkdown } from './richMarkdown'

const p = (...content: object[]) => ({ type: 'paragraph', content })
const t = (text: string, ...marks: string[]) => ({
  type: 'text',
  text,
  marks: marks.map((type) => ({ type })),
})
const doc = (...content: object[]) => ({ type: 'doc', content })

test('each format becomes GitLab Markdown', () => {
  expect(
    toMarkdown(doc(p(t('a '), t('b', 'bold'), t(' '), t('i', 'italic'), t(' '), t('s', 'strike'), t(' '), t('c', 'code')))),
  ).toBe('a **b** _i_ ~~s~~ `c`')
  expect(
    toMarkdown(doc(p({ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://x.io/a_b' } }] }))),
  ).toBe('[site](https://x.io/a_b)')
  expect(toMarkdown(doc(p(t('both', 'bold', 'italic'))))).toBe('**_both_**')
  // Neighbours with the same marks become one run.
  expect(toMarkdown(doc(p(t('a', 'bold'), t('b', 'bold'))))).toBe('**ab**')
  // Code with a backtick inside uses a longer fence.
  expect(toMarkdown(doc(p(t('a`b', 'code'))))).toBe('`` a`b ``')
})

test('typed Markdown characters stay literal', () => {
  expect(toMarkdown(doc(p(t('2*3 = 6, a_b, `x`, [y], <z>, ~w~'))))).toBe(
    '2\\*3 = 6, a\\_b, \\`x\\`, \\[y\\], \\<z>, \\~w\\~',
  )
  expect(toMarkdown(doc(p(t('# not a heading'))))).toBe('\\# not a heading')
  expect(toMarkdown(doc(p(t('- not a list'))))).toBe('\\- not a list')
  expect(toMarkdown(doc(p(t('1. not a list'))))).toBe('1\\. not a list')
  expect(toMarkdown(doc(p(t('> not a quote'))))).toBe('\\> not a quote')
  // Mentions and plain URLs pass through.
  expect(toMarkdown(doc(p(t('@ana see https://x.io/path'))))).toBe('@ana see https://x.io/path')
})

test('paragraphs, line breaks, lists (nested), and code blocks', () => {
  expect(toMarkdown(doc(p(t('one')), p(t('two'), { type: 'hardBreak' }, t('three'))))).toBe(
    'one\n\ntwo\nthree',
  )
  const item = (...content: object[]) => ({ type: 'listItem', content })
  expect(
    toMarkdown(
      doc({
        type: 'bulletList',
        content: [item(p(t('a')), { type: 'bulletList', content: [item(p(t('b')))] }), item(p(t('c')))],
      }),
    ),
  ).toBe('- a\n  - b\n- c')
  expect(
    toMarkdown(doc({ type: 'orderedList', attrs: { start: 3 }, content: [item(p(t('x'))), item(p(t('y')))] })),
  ).toBe('3. x\n4. y')
  expect(toMarkdown(doc({ type: 'codeBlock', content: [{ type: 'text', text: 'a*b\n  c' }] }))).toBe(
    '```\na*b\n  c\n```',
  )
  expect(toMarkdown(doc(p()))).toBe('')
  expect(toMarkdown(doc(p(t('x')), p()))).toBe('x')
})
