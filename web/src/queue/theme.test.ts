import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { applyTheme, resolveTheme, useTheme } from './theme'

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
  delete document.documentElement.dataset.theme
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

test('system follows the OS; an explicit choice wins', () => {
  expect(resolveTheme('system', true)).toBe('dark')
  expect(resolveTheme('system', false)).toBe('light')
  expect(resolveTheme('light', true)).toBe('light')
})

test('applying a theme marks the document', () => {
  applyTheme('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
})

test('the choice is remembered in this browser', async () => {
  const { result } = renderHook(() => useTheme())
  await waitFor(() => expect(result.current.theme).toBe('dark'))
  act(() => result.current.setChoice('light'))
  expect(document.documentElement.dataset.theme).toBe('light')
  await expect(fake.store.get('theme')).resolves.toBe('light')
})
