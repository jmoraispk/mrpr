import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { installPlatform, platform } from '../../platform/platform'
import { createFakePlatform } from '../../test/fakePlatform'
import { MrPanel } from './MrPanel'

const transport = vi.hoisted(() => ({
  getOverview: vi.fn(),
  markLooked: vi.fn(),
}))
vi.mock('../../transport/runtime', () => ({ createRuntimeTransport: () => transport }))
vi.mock('../../App', () => ({
  default: (props: { sinceFrom?: string | null }) => (
    <p>code view since {String(props.sinceFrom)}</p>
  ),
}))

const T = { hostId: 'h', project: 'g/p', iid: 1 }
const OVERVIEW = {
  iid: 1,
  title: 'Retry budget',
  description: 'Adds a budget.',
  headSha: 'head-2',
  discussions: [],
  additions: 3,
  deletions: 1,
  files: 2,
  commitCount: 4,
}
const LOOK = { 'h:g/p!1': { headSha: 'head-1', at: '2026-10-11T08:00:00Z' } }

let client: QueryClient
beforeEach(() => {
  installPlatform(createFakePlatform())
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  transport.getOverview.mockReset().mockResolvedValue(OVERVIEW)
  // Like the real one: the look is written to the store.
  transport.markLooked.mockReset().mockImplementation(async (sha: string) => {
    await platform().store.set({ lastLook: { 'h:g/p!1': { headSha: sha, at: new Date().toISOString() } } })
  })
})

const panel = (tab: 'overview' | 'changes' | 'since' = 'overview') => (
  <QueryClientProvider client={client}>
    <MrPanel
      target={T}
      row={null}
      me="joao"
      tab={tab}
      full={false}
      noteId={null}
      header={(o) => <h2>{o?.title}</h2>}
      overview={(o) => <p>{o.description}</p>}
    />
  </QueryClientProvider>
)

test('tabs are links to their own addresses; Changes counts the diff', async () => {
  render(panel())
  expect(await screen.findByText('Adds a budget.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Changes · 2 files · +3 −1' })).toHaveAttribute(
    'href',
    '#/mr/h/g%2Fp/1/changes',
  )
})

test('Since last review appears only when the head moved since your last look', async () => {
  await platform().store.set({ lastLook: LOOK })
  render(panel())
  expect(await screen.findByRole('link', { name: /Since last review/ })).toHaveAttribute(
    'href',
    '#/mr/h/g%2Fp/1/since',
  )
})

test('opening the panel records the look, but Since still diffs from before', async () => {
  await platform().store.set({ lastLook: LOOK })
  const view = render(panel('overview'))
  await waitFor(() => expect(transport.markLooked).toHaveBeenCalledWith('head-2'))
  view.rerender(panel('since'))
  expect(await screen.findByText('code view since head-1')).toBeInTheDocument()
})

test('an overview that fails says why, and Changes still works', async () => {
  const user = userEvent.setup()
  transport.getOverview.mockRejectedValue(
    new Error('This merge request is gone or you no longer have access'),
  )
  render(panel())
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This merge request is gone or you no longer have access',
  )
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(transport.getOverview).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('link', { name: /^Changes/ })).toBeInTheDocument()
})
