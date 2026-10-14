import { fireEvent, render, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { useQueueKeys } from './useQueueKeys'

function handlers() {
  return {
    move: vi.fn(),
    open: vi.fn(),
    approve: vi.fn(),
    reply: vi.fn(),
    changes: vi.fn(),
    nudge: vi.fn(),
    snooze: vi.fn(),
    moveProject: vi.fn(),
    diffSince: vi.fn(),
    search: vi.fn(),
    sidebar: vi.fn(),
    help: vi.fn(),
    close: vi.fn(),
    full: vi.fn(),
  }
}

test('single keys map to actions', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  for (const key of ['j', 'k', 'Enter', 'o', 'a', 'r', 'x', 'n', 's', 'm', 'd', '/', 'b', '?']) {
    fireEvent.keyDown(window, { key })
  }
  expect(h.move.mock.calls).toEqual([[1], [-1]])
  expect(h.open).toHaveBeenCalledTimes(2)
  for (const name of [
    'approve',
    'reply',
    'changes',
    'nudge',
    'snooze',
    'moveProject',
    'diffSince',
    'search',
    'sidebar',
    'help',
  ] as const) {
    expect(h[name]).toHaveBeenCalledOnce()
  }
})

test('g starts nothing any more: the next key is itself', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  fireEvent.keyDown(window, { key: 'g' })
  fireEvent.keyDown(window, { key: 'n' })
  expect(h.nudge).toHaveBeenCalledOnce()
})

test('keys are inert while typing', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  const { container } = render(<textarea />)
  const box = container.querySelector('textarea')!
  box.focus()
  for (const key of ['a', 'x', '/', 'b', ' ', 'j']) fireEvent.keyDown(box, { key })
  for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
})

test('Ctrl+B toggles the sidebar, but not while typing', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
  expect(h.sidebar).toHaveBeenCalledOnce()
  const { container } = render(<input type="search" />)
  const input = container.querySelector('input')!
  input.focus()
  fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
  expect(h.sidebar).toHaveBeenCalledOnce()
})

test('other modifier combinations are left to the browser', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  fireEvent.keyDown(window, { key: 'r', ctrlKey: true })
  fireEvent.keyDown(window, { key: 'b', metaKey: true })
  fireEvent.keyDown(window, { key: 'b', ctrlKey: true, shiftKey: true })
  fireEvent.keyDown(window, { key: 'j', altKey: true })
  for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
})

test('Space and Enter on a button belong to the button', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  const { container } = render(<button type="button">Approve</button>)
  const button = container.querySelector('button')!
  fireEvent.keyDown(button, { key: ' ' })
  fireEvent.keyDown(button, { key: 'Enter' })
  expect(h.open).not.toHaveBeenCalled()
})

test('Escape closes and f toggles full screen', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.keyDown(window, { key: 'f' })
  expect(h.close).toHaveBeenCalledOnce()
  expect(h.full).toHaveBeenCalledOnce()
})
