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
    done: vi.fn(),
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
  for (const key of ['j', 'k', 'Enter', 'o', 'a', 'r', 'x', 'n', 's', 'e', 'd', '/', 'b', '?']) {
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
    'done',
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

test('keys are inert while a site dialog is open', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  render(<dialog className="q-modal" open />)
  fireEvent.keyDown(window, { key: 'a' })
  fireEvent.keyDown(window, { key: 'j' })
  for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled()
})

test('keys typed in a rich (contenteditable) box never act on the queue', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  const inner = document.createElement('p')
  editable.append(inner)
  document.body.append(editable)
  fireEvent.keyDown(inner, { key: 'j' })
  fireEvent.keyDown(inner, { key: 'b', ctrlKey: true })
  fireEvent.keyDown(inner, { key: 'Escape' })
  expect(h.move).not.toHaveBeenCalled()
  expect(h.sidebar).not.toHaveBeenCalled()
  expect(h.close).not.toHaveBeenCalled()
  editable.remove()
})

test('m is no longer a key', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  fireEvent.keyDown(window, { key: 'm' })
  expect(Object.values(h).every((fn) => fn.mock.calls.length === 0)).toBe(true)
})
