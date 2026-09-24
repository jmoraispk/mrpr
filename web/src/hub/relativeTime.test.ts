import { expect, test } from 'vitest'

import { relativeTime } from './relativeTime'

const NOW = new Date('2026-09-24T12:00:00.000Z')
const ago = (seconds: number) =>
  new Date(NOW.getTime() - seconds * 1000).toISOString()

test('recent times read as spans, older ones as dates', () => {
  expect(relativeTime(ago(20), NOW)).toBe('just now')
  expect(relativeTime(ago(5 * 60), NOW)).toBe('5m ago')
  expect(relativeTime(ago(3 * 3600), NOW)).toBe('3h ago')
  expect(relativeTime(ago(2 * 86400), NOW)).toBe('2d ago')
  expect(relativeTime(ago(10 * 86400), NOW)).toBe(
    new Date(ago(10 * 86400)).toLocaleDateString(),
  )
  expect(relativeTime('not a date', NOW)).toBe('')
})
