import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { DEFAULT_FILTERS } from './activity'
import { normalizeFilterStore, useActivityFilters } from './activityFilters'

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
})

test('defaults until changed; "all MRs" changes the default for every MR', async () => {
  const one = renderHook(() => useActivityFilters('h:g/p!1'))
  const two = renderHook(() => useActivityFilters('h:g/p!2'))
  expect(one.result.current.filters).toEqual(DEFAULT_FILTERS)
  act(() => one.result.current.setFilter('resolved', true, 'all'))
  await waitFor(() => expect(two.result.current.filters.resolved).toBe(true))
  expect(two.result.current.scope).toBe('all')
})

test('"this MR" overrides one MR only, and reset removes the override', async () => {
  const one = renderHook(() => useActivityFilters('h:g/p!1'))
  const two = renderHook(() => useActivityFilters('h:g/p!2'))
  act(() => one.result.current.setFilter('bots', true, 'mr'))
  await waitFor(() => expect(one.result.current.filters.bots).toBe(true))
  expect(one.result.current.scope).toBe('mr')
  expect(two.result.current.filters.bots).toBe(false)
  act(() => one.result.current.reset())
  await waitFor(() => expect(one.result.current.filters.bots).toBe(false))
  await expect(fake.store.get('activityFilters')).resolves.toMatchObject({ perMr: {} })
})

test('a damaged stored value falls back to the defaults', () => {
  expect(normalizeFilterStore('junk')).toEqual({ defaults: DEFAULT_FILTERS, perMr: {} })
  expect(
    normalizeFilterStore({ defaults: { resolved: 'yes' }, perMr: { a: { bots: true }, b: 7 } }),
  ).toEqual({
    defaults: DEFAULT_FILTERS,
    perMr: { a: { ...DEFAULT_FILTERS, bots: true } },
  })
})
