import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { MrOverview } from '../../gitlab/mrOverview'
import { RebaseControl } from './RebaseControl'

const transport = vi.hoisted(() => ({ rebase: vi.fn(), getOverview: vi.fn() }))
vi.mock('../../transport/runtime', () => ({ createRuntimeTransport: () => transport }))

const T = { hostId: 'h', project: 'g/p', iid: 1 }
const o = (over: Partial<MrOverview> = {}) =>
  ({
    targetBranch: 'main',
    shouldBeRebased: true,
    rebaseInProgress: false,
    canPush: true,
    ...over,
  }) as MrOverview

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  transport.rebase.mockReset().mockResolvedValue(undefined)
  transport.getOverview.mockReset()
})
afterEach(() => vi.useRealTimers())

const control = (overview: MrOverview, target = T, key = 'one') => (
  <QueryClientProvider client={client}>
    <RebaseControl key={key} overview={overview} target={target} />
  </QueryClientProvider>
)

test('hidden unless the MR should be rebased and you can push', () => {
  const view = render(control(o({ shouldBeRebased: false })))
  expect(screen.queryByRole('button', { name: 'Rebase' })).toBeNull()
  view.rerender(control(o({ canPush: false })))
  expect(screen.queryByRole('button', { name: 'Rebase' })).toBeNull()
})

test('rebase asks GitLab, shows progress, and finishes when GitLab says so', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  transport.getOverview
    .mockResolvedValueOnce(o({ rebaseInProgress: true }))
    .mockResolvedValueOnce(o({ shouldBeRebased: false, rebaseInProgress: false }))
  render(control(o()))
  expect(screen.getByText('Behind main')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Rebase' }))
  expect(transport.rebase).toHaveBeenCalledOnce()
  expect(screen.getByText('Rebasing…')).toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(3_000))
  await act(() => vi.advanceTimersByTimeAsync(3_000))
  expect(await screen.findByText('Rebased')).toBeInTheDocument()
})

test('a refused rebase says why', async () => {
  const user = userEvent.setup()
  transport.rebase.mockRejectedValueOnce(new Error('Rebase failed: conflicts. Please rebase locally.'))
  render(control(o()))
  await user.click(screen.getByRole('button', { name: 'Rebase' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Rebase failed: conflicts')
})

test('polling stops when the panel moves to another MR', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  transport.getOverview.mockResolvedValue(o({ rebaseInProgress: true }))
  const view = render(control(o()))
  await user.click(screen.getByRole('button', { name: 'Rebase' }))
  view.rerender(control(o(), { ...T, iid: 2 }, 'two'))
  expect(screen.queryByText('Rebasing…')).toBeNull()
  const calls = transport.getOverview.mock.calls.length
  await act(() => vi.advanceTimersByTimeAsync(9_000))
  expect(transport.getOverview.mock.calls.length).toBe(calls)
})
