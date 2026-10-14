import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

import { TAG_PRIORITY } from './tags'

// vitest runs from web/.
const css = readFileSync(resolve(process.cwd(), 'src/queue/queue.css'), 'utf8')
const styled = [...css.matchAll(/\.q-tag\.is-([a-z-]+)/g)].map((match) => match[1])

test('every label style is for a label that exists', () => {
  for (const kind of styled) expect([...TAG_PRIORITY, 'more'], kind).toContain(kind)
})

test('Waiting on you stands out from the other labels', () => {
  expect(styled).toContain('waiting-on-you')
})
