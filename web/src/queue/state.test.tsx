import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { migrateSnoozed, useDone, useSnoozedMrs } from './state'

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
})

test('ticking done stores the MR version; moving it back removes it', async () => {
  const { result } = renderHook(() => useDone())
  act(() => result.current[1]('h:1', '2026-10-11T10:00:00.000Z'))
  await waitFor(() => expect(result.current[0]).toEqual({ 'h:1': '2026-10-11T10:00:00.000Z' }))
  act(() => result.current[1]('h:1', null))
  await waitFor(() => expect(result.current[0]).toEqual({}))
})

test('snoozing stores when; unsnoozing removes it', async () => {
  const { result } = renderHook(() => useSnoozedMrs())
  act(() => result.current[1]('h:1', true))
  await waitFor(() => expect(Object.keys(result.current[0])).toEqual(['h:1']))
  expect(Number.isNaN(Date.parse(result.current[0]['h:1']))).toBe(false)
  act(() => result.current[1]('h:1', false))
  await waitFor(() => expect(result.current[0]).toEqual({}))
})

test('migration moves old snoozes into done, keeps done entries that already exist and removes snoozed', async () => {
  await fake.store.set({ snoozed: { a: '1', b: '2', bad: 3 }, done: { b: 'kept' } })
  await migrateSnoozed()
  expect(await fake.store.get('done')).toEqual({ a: '1', b: 'kept' })
  expect(await fake.store.get('snoozed')).toBeUndefined()
  expect(await fake.store.get('snoozedMrs')).toBeUndefined()
  // Again (another tab, the next load): nothing changes.
  await migrateSnoozed()
  expect(await fake.store.get('done')).toEqual({ a: '1', b: 'kept' })
})
