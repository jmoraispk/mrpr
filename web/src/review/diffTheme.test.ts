import { afterEach, expect, test, vi } from 'vitest'

import { preferredTheme, watchTheme } from './diffTheme'

afterEach(() => {
  delete document.documentElement.dataset.theme
})

test('the app’s chosen theme wins over the system’s', () => {
  document.documentElement.dataset.theme = 'light'
  expect(preferredTheme()).toBe('light')
  document.documentElement.dataset.theme = 'dark'
  expect(preferredTheme()).toBe('dark')
})

test('switching the app’s theme re-themes the diff', async () => {
  document.documentElement.dataset.theme = 'dark'
  const onChange = vi.fn()
  const stop = watchTheme(onChange)
  document.documentElement.dataset.theme = 'light'
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('light'))
  stop()
  document.documentElement.dataset.theme = 'dark'
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(onChange).toHaveBeenCalledTimes(1)
})
