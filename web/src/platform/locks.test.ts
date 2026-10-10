import { afterEach, expect, test, vi } from 'vitest'

import { withLock } from './locks'

afterEach(() => vi.unstubAllGlobals())

test('without Web Locks, holders run one at a time', async () => {
  const order: string[] = []
  let release!: () => void
  const first = withLock('x', async () => {
    order.push('first start')
    await new Promise<void>((resolve) => {
      release = resolve
    })
    order.push('first end')
    return 1
  })
  const second = withLock('x', async () => {
    order.push('second')
    return 2
  })
  await Promise.resolve()
  release()

  await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
  expect(order).toEqual(['first start', 'first end', 'second'])
})

test('ifAvailable skips when the lock is held', async () => {
  let release!: () => void
  const held = withLock('y', () => new Promise<void>((resolve) => (release = resolve)))

  await expect(withLock('y', async () => 'ran', { ifAvailable: true })).resolves.toBeUndefined()
  release()
  await held
  await expect(withLock('y', async () => 'ran', { ifAvailable: true })).resolves.toBe('ran')
})

test('Web Locks are used when the browser has them', async () => {
  const request = vi.fn(
    async (_name: string, options: { ifAvailable: boolean }, fn: (lock: unknown) => unknown) =>
      fn(options.ifAvailable ? null : {}),
  )
  vi.stubGlobal('navigator', { ...navigator, locks: { request } })

  await expect(withLock('z', async () => 'held')).resolves.toBe('held')
  await expect(withLock('z', async () => 'held', { ifAvailable: true })).resolves.toBeUndefined()
  expect(request.mock.calls.map((call) => [call[0], call[1]])).toEqual([
    ['z', { ifAvailable: false }],
    ['z', { ifAvailable: true }],
  ])
})
