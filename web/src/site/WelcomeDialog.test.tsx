import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'

import { installPlatform, platform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { WelcomeDialog } from './WelcomeDialog'

beforeEach(() => installPlatform(createFakePlatform()))

test('the welcome shows once, says everything is unlocked, and Start reviewing closes it for good', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<WelcomeDialog />)
  const dialog = await screen.findByRole('dialog', { name: 'Welcome' })
  for (const line of [
    'Welcome to Mr. PR.',
    'Everything is unlocked during early access:',
    '✓ Unlimited MRs/PRs',
    '✓ Unlimited accounts and repos',
    '✓ One-click nudges',
    '✓ Review budget and estimates',
    'Something rough or missing? Hit Feedback anytime. We read every message.',
  ]) {
    expect(dialog).toHaveTextContent(line)
  }
  await user.click(screen.getByRole('button', { name: 'Start reviewing' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await expect(platform().store.get('welcomed')).resolves.toBe(true)
  unmount()
  render(<WelcomeDialog />)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(screen.queryByRole('dialog')).toBeNull()
})
