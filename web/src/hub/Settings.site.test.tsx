import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { Settings } from './Settings'

const HOST = {
  id: 'gitlab.example.com',
  host: 'gitlab.example.com',
  apiBase: 'https://gitlab.example.com/api/v4',
  userId: 7,
  username: 'joao',
}

let fake: ReturnType<typeof createFakePlatform>

beforeEach(() => {
  fake = createFakePlatform({
    send: async (message) => {
      fake.sent.push(message)
      if (message.kind === 'delta/hub' && message.op === 'listHosts') {
        return { ok: true, data: [HOST] }
      }
      return { ok: true, data: null }
    },
  })
  installPlatform(fake)
})

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>,
  )
}

test('signed-in hosts offer sign out, and nothing asks for a token', async () => {
  renderSettings()

  expect(await screen.findByText('gitlab.example.com')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  expect(screen.queryByLabelText(/token/i)).toBeNull()
  expect(screen.queryByText('Add a host')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Grant access' })).toBeNull()
})

test('signing out asks the router to remove the host', async () => {
  const user = userEvent.setup()
  renderSettings()

  await user.click(await screen.findByRole('button', { name: 'Sign out' }))

  await waitFor(() =>
    expect(fake.sent).toContainEqual({
      kind: 'delta/hub',
      op: 'removeHost',
      payload: { id: 'gitlab.example.com' },
    }),
  )
})

test('the bot preference is stored through the platform', async () => {
  const user = userEvent.setup()
  renderSettings()

  await user.click(
    await screen.findByRole('checkbox', { name: /Hide comments from bots/i }),
  )

  await waitFor(async () =>
    expect(await fake.store.get('inboxSettings')).toEqual({ hideBots: false }),
  )
})
