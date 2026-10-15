import { expect, test } from 'vitest'

import { changeLine, summarizeChanges } from './changeSummary'

test('modified, new, deleted; moved only when there are some', () => {
  const files = [
    ...Array.from({ length: 15 }, () => ({})),
    ...Array.from({ length: 4 }, () => ({ new_file: true })),
  ]
  const summary = summarizeChanges(files)
  expect(summary).toEqual({ modified: 15, added: 4, deleted: 0, moved: 0 })
  expect(changeLine(summary)).toBe('15 mod 4 new 0 del')
  const moved = summarizeChanges([{ renamed_file: true }, { deleted_file: true }, {}])
  expect(changeLine(moved)).toBe('1 mod 0 new 1 del 1 mov')
})
