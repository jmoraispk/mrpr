import { expect, test } from 'vitest'

import { relativeTime, shortTime } from './relativeTime'

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

test('shortTime: now, minutes, hours, days, weeks, months, years, no "ago"', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  expect(shortTime(at(20_000), now)).toBe('now')
  expect(shortTime(at(5 * MIN), now)).toBe('5m')
  expect(shortTime(at(HOUR), now)).toBe('1h')
  expect(shortTime(at(22 * HOUR), now)).toBe('22h')
  expect(shortTime(at(DAY), now)).toBe('1d')
  expect(shortTime(at(6 * DAY), now)).toBe('6d')
  expect(shortTime(at(7 * DAY), now)).toBe('1w')
  expect(shortTime(at(29 * DAY), now)).toBe('4w')
  expect(shortTime(at(90 * DAY), now)).toBe('3mo')
  expect(shortTime(at(400 * DAY), now)).toBe('1y')
  // A clock a little ahead of GitLab's is still "now", and junk is blank.
  expect(shortTime(new Date(now.getTime() + 5000).toISOString(), now)).toBe('now')
  expect(shortTime('junk', now)).toBe('')
})
