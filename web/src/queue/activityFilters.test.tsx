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

test('with an MR open, a change is that MR’s own; the same choices as the default drop the copy', async () => {
  const one = renderHook(() => useActivityFilters('h:g/p!1'))
  const two = renderHook(() => useActivityFilters('h:g/p!2'))
  act(() => one.result.current.setFilter('bots', true))
  await waitFor(() => expect(one.result.current.filters.bots).toBe(true))
  expect(one.result.current.differs).toBe(true)
  expect(two.result.current.filters.bots).toBe(false)
  act(() => one.result.current.setFilter('bots', false))
  await waitFor(() => expect(one.result.current.differs).toBe(false))
  await expect(fake.store.get('activityFilters')).resolves.toMatchObject({ perMr: {} })
})

test('Apply to all MRs makes this MR’s choices the default and drops its copy', async () => {
  const one = renderHook(() => useActivityFilters('h:g/p!1'))
  const two = renderHook(() => useActivityFilters('h:g/p!2'))
  act(() => one.result.current.setFilter('resolved', true))
  await waitFor(() => expect(one.result.current.differs).toBe(true))
  act(() => one.result.current.applyToAll())
  await waitFor(() => expect(two.result.current.filters.resolved).toBe(true))
  expect(one.result.current.differs).toBe(false)
  await expect(fake.store.get('activityFilters')).resolves.toMatchObject({ perMr: {} })
})

test('with no MR open, a change edits the default and keeps other MRs’ copies', async () => {
  await fake.store.set({ activityFilters: { defaults: DEFAULT_FILTERS, perMr: { 'h:g/p!1': { ...DEFAULT_FILTERS, bots: true } } } })
  const none = renderHook(() => useActivityFilters(null))
  const one = renderHook(() => useActivityFilters('h:g/p!1'))
  await waitFor(() => expect(one.result.current.filters.bots).toBe(true))
  act(() => none.result.current.setFilter('commits', false))
  await waitFor(async () =>
    expect(await fake.store.get('activityFilters')).toMatchObject({
      defaults: { commits: false },
      perMr: { 'h:g/p!1': { bots: true } },
    }),
  )
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
