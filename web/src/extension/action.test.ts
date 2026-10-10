import { beforeEach, expect, test, vi } from 'vitest'

import { createFakeBrowser } from '../test/fakeBrowser'

const fake = createFakeBrowser() as ReturnType<typeof createFakeBrowser> & {
  runtime: { getURL: (path: string) => string }
  tabs: {
    get: (id: number) => Promise<{ id: number }>
    create: (info: { url: string }) => Promise<{ id: number; windowId: number }>
    update: (
      id: number,
      info: unknown,
    ) => Promise<{ id: number; windowId: number }>
  }
  // Optional because Firefox for Android omits `browser.windows` entirely, and
  // one test deletes it to stand in for that.
  windows?: {
    update: (id: number, info: unknown) => Promise<{ id: number }>
  }
}
const calls: string[] = []
let existingTab: number | null = null
fake.runtime = { getURL: (path) => `chrome-extension://abc/${path}` }
fake.tabs = {
  get: async (id) => {
    if (existingTab !== id) throw new Error('No tab with id')
    return { id }
  },
  create: async ({ url }) => {
    calls.push(`create:${url}`)
    existingTab = 1
    return { id: 1, windowId: 5 }
  },
  update: async (id, info) => {
    calls.push(`update:${id}:${(info as { url: string }).url}`)
    return { id, windowId: 5 }
  },
}
fake.windows = {
  update: async (id, info) => {
    calls.push(`focus:${id}:${(info as { focused: boolean }).focused}`)
    return { id }
  },
}
vi.mock('webextension-polyfill', () => ({ default: fake }))
await import('../test/installExtensionPlatform')

const { saveHost } = await import('./hosts')
const { forgetHubTab, hashForTab, openHub } = await import('./action')

const HOSTS = [
  {
    id: 'gitlab.example.com',
    host: 'gitlab.example.com',
    apiBase: 'https://gitlab.example.com/api/v4',
    userId: 7,
    username: 'joao',
  },
]

beforeEach(async () => {
  for (const key of Object.keys(fake.data)) delete fake.data[key]
  calls.length = 0
  existingTab = null
  await saveHost(HOSTS[0], 'token')
})

test('a merge request tab yields that review hash', () => {
  expect(
    hashForTab(
      'https://gitlab.example.com/group/p/-/merge_requests/42',
      HOSTS,
    ),
  ).toBe('#/mr/gitlab.example.com/group%2Fp/42')
})

test('any other tab yields the lists', () => {
  expect(hashForTab('https://example.com', HOSTS)).toBe('#/')
  expect(hashForTab(undefined, HOSTS)).toBe('#/')
})

test('the first click creates a hub tab', async () => {
  await openHub('https://example.com')
  expect(calls).toEqual(['create:chrome-extension://abc/hub.html#/'])
})

test('a second click reuses the tab and brings its window forward', async () => {
  await openHub('https://example.com')
  calls.length = 0
  await openHub('https://gitlab.example.com/group/p/-/merge_requests/42')
  expect(calls).toEqual([
    'update:1:chrome-extension://abc/hub.html#/mr/gitlab.example.com/group%2Fp/42',
    'focus:5:true',
  ])
})

test('a browser with no windows API still reuses the tab', async () => {
  await openHub('https://example.com')
  calls.length = 0
  const windows = fake.windows
  delete fake.windows
  try {
    await openHub('https://example.com')
  } finally {
    fake.windows = windows
  }
  expect(calls).toEqual(['update:1:chrome-extension://abc/hub.html#/'])
})

test('a closed hub tab is recreated', async () => {
  await openHub('https://example.com')
  existingTab = null
  calls.length = 0
  await openHub('https://example.com')
  expect(calls).toEqual(['create:chrome-extension://abc/hub.html#/'])
})

test('a tab id left over from a previous session is not reused', async () => {
  // Tab 1 exists in this session, but this session did not create it as the
  // hub — the id is a leftover that outlived a restart in storage.
  await fake.storage.local.set({ hubTabId: 1 })
  existingTab = 1

  await forgetHubTab()
  await openHub('https://example.com')

  expect(calls).toEqual(['create:chrome-extension://abc/hub.html#/'])
})
