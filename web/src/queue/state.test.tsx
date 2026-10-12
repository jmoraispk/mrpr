import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { useProjects, useSnoozed } from './state'

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
})

test('projects persist and update across hook instances', async () => {
  const first = renderHook(() => useProjects())
  const second = renderHook(() => useProjects())
  act(() =>
    first.result.current[1]([
      { id: 'p', name: 'P', color: '#C2410C', rules: { repositories: [], labels: [] }, pinned: [] },
    ]),
  )
  await waitFor(() => expect(second.result.current[0]).toHaveLength(1))
  await expect(fake.store.get('projects')).resolves.toHaveLength(1)
})

test('snoozing stores the MR version; unsnoozing removes it', async () => {
  const { result } = renderHook(() => useSnoozed())
  act(() => result.current[1]('h:1', '2026-10-11T10:00:00.000Z'))
  await waitFor(() => expect(result.current[0]).toEqual({ 'h:1': '2026-10-11T10:00:00.000Z' }))
  act(() => result.current[1]('h:1', null))
  await waitFor(() => expect(result.current[0]).toEqual({}))
})
