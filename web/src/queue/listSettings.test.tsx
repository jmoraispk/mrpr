import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import {
  DEFAULT_LIST_FILTERS,
  DEFAULT_LIST_ORDER,
  normalizeCollapsed,
  normalizeListFilters,
  normalizeListOrder,
  normalizeListView,
  normalizeSidebar,
  normalizeTab,
  SIDEBAR_WIDTH,
  useListOrder,
} from './listSettings'

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
})

test('stored filters keep what is valid and default the rest', () => {
  expect(normalizeListFilters(undefined)).toEqual(DEFAULT_LIST_FILTERS)
  expect(normalizeListFilters('junk')).toEqual(DEFAULT_LIST_FILTERS)
  expect(normalizeListFilters({ needsMeOnly: true, hideDrafts: 'yes', extra: 1 })).toEqual({
    ...DEFAULT_LIST_FILTERS,
    needsMeOnly: true,
  })
  expect(normalizeListFilters({ allMrs: true, authored: false, showDone: true })).toEqual({
    ...DEFAULT_LIST_FILTERS,
    allMrs: true,
  })
  // Show merged starts on.
  expect(DEFAULT_LIST_FILTERS).toEqual({ needsMeOnly: false, hideDrafts: false, showMerged: true, allMrs: false })
})

test('the list view is To do unless Done or All was chosen', () => {
  expect(normalizeListView('done')).toBe('done')
  expect(normalizeListView('all')).toBe('all')
  expect(normalizeListView('x')).toBe('todo')
  expect(normalizeListView(undefined)).toBe('todo')
})

test('the sidebar is open unless stored closed; collapsed groups are distinct strings', () => {
  expect(normalizeSidebar(undefined)).toEqual({ open: true, width: 400 })
  expect(normalizeSidebar({ open: false })).toEqual({ open: false, width: 400 })
  expect(normalizeSidebar({ open: 'no', width: 420 })).toEqual({ open: true, width: 420 })
  expect(normalizeCollapsed(['a', 3, 'a', 'b'])).toEqual(['a', 'b'])
  expect(normalizeCollapsed({})).toEqual([])
})

test('the order is saved in this browser and shared across the page', async () => {
  const first = renderHook(() => useListOrder())
  const second = renderHook(() => useListOrder())
  act(() => first.result.current[1]({ sortBy: 'size', descending: false }))
  await waitFor(() =>
    expect(second.result.current[0]).toEqual({ sortBy: 'size', descending: false }),
  )
  await expect(fake.store.get('listOrder')).resolves.toEqual({ sortBy: 'size', descending: false })
})

test('a stored width is kept within its limits', () => {
  expect(normalizeSidebar({ open: true, width: 9999 })).toEqual({ open: true, width: 600 })
  expect(normalizeSidebar({ open: true, width: 10 })).toEqual({ open: true, width: 260 })
  expect(normalizeSidebar({ open: true, width: 'wide' })).toEqual({ open: true, width: 400 })
})

test('the sidebar is 400 wide by default; the old default of 360 reads as 400', () => {
  expect(SIDEBAR_WIDTH.default).toBe(400)
  expect(normalizeSidebar({ open: true, width: 360 })).toEqual({ open: true, width: 400 })
  expect(normalizeSidebar({ open: false, width: 361 })).toEqual({ open: false, width: 361 })
  expect(normalizeSidebar('junk')).toEqual({ open: true, width: 400 })
})

test('the list order: a sort and a direction; anything else, old shapes included, is Last changed, newest first', () => {
  expect(DEFAULT_LIST_ORDER).toEqual({ sortBy: 'changed', descending: true })
  expect(normalizeListOrder({ sortBy: 'size', descending: true })).toEqual({ sortBy: 'size', descending: true })
  expect(normalizeListOrder({ tags: ['returned'], sortBy: 'waiting' })).toEqual(DEFAULT_LIST_ORDER)
  expect(normalizeListOrder({ sortBy: 'age' })).toEqual(DEFAULT_LIST_ORDER)
  expect(normalizeListOrder('junk')).toEqual(DEFAULT_LIST_ORDER)
})

test('the sidebar tab: From others unless From me was chosen', () => {
  expect(normalizeTab('mine')).toBe('mine')
  expect(normalizeTab('others')).toBe('others')
  expect(normalizeTab('junk')).toBe('others')
  expect(normalizeTab(undefined)).toBe('others')
})
