import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { RefreshButton } from './RefreshButton'

afterEach(() => vi.useRealTimers())

test('says how long ago the list was refreshed, and refreshes on click', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
  const onRefresh = vi.fn()
  render(
    <RefreshButton
      updatedAt={Date.parse('2026-10-15T11:58:30Z')}
      refreshing={false}
      onRefresh={onRefresh}
    />,
  )
  const button = screen.getByRole('button', { name: 'Refresh, updated 1m ago' })
  expect(button).toHaveTextContent('↻ 1m')
  act(() => vi.advanceTimersByTime(30_000))
  expect(screen.getByRole('button', { name: 'Refresh, updated 2m ago' })).toBeInTheDocument()
  fireEvent.click(button)
  expect(onRefresh).toHaveBeenCalledOnce()
})

test('just refreshed reads now; while refreshing it waits and cannot be pressed again', () => {
  const { rerender } = render(
    <RefreshButton updatedAt={Date.now()} refreshing={false} onRefresh={() => {}} />,
  )
  expect(screen.getByRole('button', { name: 'Refresh, updated just now' })).toHaveTextContent('↻ now')
  const onRefresh = vi.fn()
  rerender(<RefreshButton updatedAt={Date.now()} refreshing onRefresh={onRefresh} />)
  const busy = screen.getByRole('button', { name: 'Refreshing' })
  expect(busy).toHaveTextContent('↻ …')
  // Not disabled: keyboard focus stays on it through the minute's refresh.
  expect(busy).not.toBeDisabled()
  expect(busy).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(busy)
  expect(onRefresh).not.toHaveBeenCalled()
  // A refresh that lands a moment "in the future" by the local clock is still now.
  rerender(<RefreshButton updatedAt={Date.now() + 5000} refreshing={false} onRefresh={onRefresh} />)
  expect(screen.getByRole('button', { name: 'Refresh, updated just now' })).toBeInTheDocument()
})
