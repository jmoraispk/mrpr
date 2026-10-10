import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { createFakeBrowser } from '../test/fakeBrowser'

const reload = vi.fn()
const fake = createFakeBrowser() as ReturnType<typeof createFakeBrowser> & {
  runtime: { reload: () => void }
}
fake.runtime = { reload }

vi.mock('webextension-polyfill', () => ({ default: fake }))
await import('../test/installExtensionPlatform')

beforeEach(() => {
  reload.mockClear()
  vi.stubGlobal('__DELTA_DEV__', true)
})

test('reloads the extension when clicked', async () => {
  const { DevReload } = await import('./devReload')
  render(<DevReload />)

  await userEvent.click(screen.getByRole('button', { name: /reload extension/i }))

  expect(reload).toHaveBeenCalledOnce()
})

// The hub tab closed on every measured reload, but never against an extension
// that actually came back, so the title warns without promising. It used to
// say the tab "needs a refresh afterwards", which asserted a remedy for a
// specific outcome that was never confirmed. See check 23 in
// docs/extension-smoke.md, which asks a human to settle it.
test('warns that the tab may not survive, and names a remedy that fits either way', async () => {
  const { DevReload } = await import('./devReload')
  render(<DevReload />)

  const title =
    screen.getByRole('button', { name: /reload extension/i }).getAttribute('title') ?? ''

  expect(title).toMatch(/may not survive/i)
  expect(title).toMatch(/reopen the hub/i)
})

test('renders nothing in a release build', async () => {
  vi.stubGlobal('__DELTA_DEV__', false)
  const { DevReload } = await import('./devReload')
  const { container } = render(<DevReload />)

  expect(container).toBeEmptyDOMElement()
  expect(
    screen.queryByRole('button', { name: /reload extension/i }),
  ).toBeNull()
})
