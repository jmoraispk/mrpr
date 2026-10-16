import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { useSnoozed } from './state'

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
})

test('snoozing stores the MR version; unsnoozing removes it', async () => {
  const { result } = renderHook(() => useSnoozed())
  act(() => result.current[1]('h:1', '2026-10-11T10:00:00.000Z'))
  await waitFor(() => expect(result.current[0]).toEqual({ 'h:1': '2026-10-11T10:00:00.000Z' }))
  act(() => result.current[1]('h:1', null))
  await waitFor(() => expect(result.current[0]).toEqual({}))
})
