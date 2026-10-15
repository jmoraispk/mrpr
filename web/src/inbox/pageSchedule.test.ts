import { afterEach, expect, test, vi } from 'vitest'

import { startPageSchedule } from './pageSchedule'

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

test('polls every minute while the page is open', () => {
  vi.useFakeTimers()
  const poll = vi.fn(async () => {})
  const stop = startPageSchedule({ poll })

  vi.advanceTimersByTime(59_000)
  expect(poll).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1_000)
  expect(poll).toHaveBeenCalledWith({})
  vi.advanceTimersByTime(60_000)
  expect(poll).toHaveBeenCalledTimes(2)

  stop()
  vi.advanceTimersByTime(600_000)
  expect(poll).toHaveBeenCalledTimes(2)
})

test('returning to the tab catches up if the last poll is stale', () => {
  const poll = vi.fn(async () => {})
  const stop = startPageSchedule({ poll })

  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  expect(poll).not.toHaveBeenCalled()

  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  expect(poll).toHaveBeenCalledWith({ maxAgeMs: 60_000 })
  stop()
})
