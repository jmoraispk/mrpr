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
  normalizeSidebar,
  toggleTag,
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
    needsMeOnly: true,
    hideDrafts: false,
    showDone: false,
  })
})

test('a stored order drops unknown tags, repeats and sorts', () => {
  expect(normalizeListOrder(null)).toEqual(DEFAULT_LIST_ORDER)
  expect(
    normalizeListOrder({ tags: ['needs-rebase', 'nonsense', 'needs-rebase', 7, 'blocking'], sortBy: 'sideways' }),
  ).toEqual({ tags: ['needs-rebase', 'blocking'], sortBy: 'waiting' })
  expect(normalizeListOrder({ tags: 'needs-rebase', sortBy: 'oldest' })).toEqual({
    tags: [],
    sortBy: 'oldest',
  })
})

test('the sidebar is open unless stored closed; collapsed groups are distinct strings', () => {
  expect(normalizeSidebar(undefined)).toEqual({ open: true, width: 360 })
  expect(normalizeSidebar({ open: false })).toEqual({ open: false, width: 360 })
  expect(normalizeSidebar({ open: 'no', width: 420 })).toEqual({ open: true, width: 420 })
  expect(normalizeCollapsed(['a', 3, 'a', 'b'])).toEqual(['a', 'b'])
  expect(normalizeCollapsed({})).toEqual([])
})

test('clicking a tag adds it last; clicking it again takes it off', () => {
  const once = toggleTag(DEFAULT_LIST_ORDER, 'needs-rebase')
  const twice = toggleTag(once, 'blocking')
  expect(twice.tags).toEqual(['needs-rebase', 'blocking'])
  expect(toggleTag(twice, 'needs-rebase').tags).toEqual(['blocking'])
})

test('the order is saved in this browser and shared across the page', async () => {
  const first = renderHook(() => useListOrder())
  const second = renderHook(() => useListOrder())
  act(() => first.result.current[1]({ tags: ['returned'], sortBy: 'smallest' }))
  await waitFor(() =>
    expect(second.result.current[0]).toEqual({ tags: ['returned'], sortBy: 'smallest' }),
  )
  await expect(fake.store.get('listOrder')).resolves.toEqual({
    tags: ['returned'],
    sortBy: 'smallest',
  })
})

test('an old tag order drops the labels that no longer exist', () => {
  expect(
    normalizeListOrder({ tags: ['draft', 'new-commits', 'needs-review', 'returned'], sortBy: 'waiting' }),
  ).toEqual({ tags: ['returned'], sortBy: 'waiting' })
})

test('a stored width is kept within its limits', () => {
  expect(normalizeSidebar({ open: true, width: 9999 })).toEqual({ open: true, width: 600 })
  expect(normalizeSidebar({ open: true, width: 10 })).toEqual({ open: true, width: 260 })
  expect(normalizeSidebar({ open: true, width: 'wide' })).toEqual({ open: true, width: 360 })
})
