import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { Lists } from './Lists'

const HOST = {
  id: 'gitlab.example.com',
  host: 'gitlab.example.com',
  apiBase: 'https://gitlab.example.com/api/v4',
  userId: 7,
  username: 'joao',
}

test('on the site, a host whose sign-in ended offers to sign in again', async () => {
  const user = userEvent.setup()
  const fake = createFakePlatform({
    send: async (message) => {
      if (message.kind === 'delta/hub' && message.op === 'listHosts') return { ok: true, data: [HOST] }
      if (message.kind === 'delta/hub' && message.op === 'listMergeRequests') {
        return { ok: true, data: [{ hostId: HOST.id, host: HOST.host, error: 'signed_out' }] }
      }
      return { ok: true, data: null }
    },
  })
  installPlatform(fake)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Lists />
    </QueryClientProvider>,
  )

  await user.click(await screen.findByRole('button', { name: 'Sign in again' }))

  expect(fake.connectHost).toHaveBeenCalledWith({
    host: HOST.host,
    apiBase: HOST.apiBase,
  })
  expect(screen.queryByRole('link', { name: /Reconnect/ })).toBeNull()
})
