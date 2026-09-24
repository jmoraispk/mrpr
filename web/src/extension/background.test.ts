import { beforeEach, expect, test, vi } from 'vitest'

import { createFakeBrowser, createFakeEvent } from '../test/fakeBrowser'

const pollAll = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../inbox/poller', () => ({ pollAll }))

const fake = createFakeBrowser() as ReturnType<typeof createFakeBrowser> & {
  runtime: {
    onMessage: ReturnType<typeof createFakeEvent>
    onStartup: ReturnType<typeof createFakeEvent>
    onInstalled: ReturnType<typeof createFakeEvent>
  }
}
fake.runtime = {
  onMessage: createFakeEvent(),
  onStartup: createFakeEvent(),
  onInstalled: createFakeEvent(),
}
vi.mock('webextension-polyfill', () => ({ default: fake }))

const { POLL_ALARM, IDLE_AFTER_SECONDS } = await import('../inbox/schedule')
await import('./background')

beforeEach(() => {
  pollAll.mockClear()
  fake.idleState = 'active'
})

/** Lets the listeners' un-awaited promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('idle is measured over five minutes', () => {
  expect(fake.idleDetectionInterval).toBe(IDLE_AFTER_SECONDS)
  expect(IDLE_AFTER_SECONDS).toBe(300)
})

for (const event of ['onInstalled', 'onStartup'] as const) {
  test(`${event} schedules the two-minute poll and polls at once`, async () => {
    await fake.runtime[event].emit()
    await settle()

    expect(fake.alarmsCreated[POLL_ALARM]).toEqual({ periodInMinutes: 2 })
    expect(pollAll).toHaveBeenCalledTimes(1)
  })
}

test('the alarm polls while the user is active', async () => {
  await fake.alarms.onAlarm.emit({ name: POLL_ALARM })
  await settle()

  expect(pollAll).toHaveBeenCalledWith()
})

for (const state of ['idle', 'locked'] as const) {
  test(`an ${state} machine makes no poll`, async () => {
    fake.idleState = state

    await fake.alarms.onAlarm.emit({ name: POLL_ALARM })
    await settle()

    expect(pollAll).not.toHaveBeenCalled()
  })
}

test('another alarm is ignored', async () => {
  await fake.alarms.onAlarm.emit({ name: 'something-else' })
  await settle()

  expect(pollAll).not.toHaveBeenCalled()
})

test('returning to the machine catches up if the last poll is stale', async () => {
  await fake.idle.onStateChanged.emit('idle')
  await settle()
  expect(pollAll).not.toHaveBeenCalled()

  await fake.idle.onStateChanged.emit('active')
  await settle()
  expect(pollAll).toHaveBeenCalledWith({ maxAgeMs: 60_000 })
})

