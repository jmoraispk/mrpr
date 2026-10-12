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
    jump: vi.fn(),
    jumpProject: vi.fn(),
    help: vi.fn(),
  }
}

test('single keys map to actions', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  for (const key of ['j', 'k', 'Enter', 'o', 'a', 'r', 'x', 'n', 's', 'm', 'd', '?']) {
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
    'help',
  ] as const) {
    expect(h[name]).toHaveBeenCalledOnce()
  }
})

test('g then a letter jumps to a bucket', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  fireEvent.keyDown(window, { key: 'g' })
  fireEvent.keyDown(window, { key: 'w' })
  expect(h.jump).toHaveBeenCalledWith('waiting')
  expect(h.move).not.toHaveBeenCalled()
})

test('g then p goes to projects', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  fireEvent.keyDown(window, { key: 'g' })
  fireEvent.keyDown(window, { key: 'p' })
  expect(h.jumpProject).toHaveBeenCalledOnce()
  expect(h.jump).not.toHaveBeenCalled()
})

test('keys are inert while typing', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  const { container } = render(<textarea />)
  const box = container.querySelector('textarea')!
  box.focus()
  fireEvent.keyDown(box, { key: 'a' })
  fireEvent.keyDown(box, { key: 'x' })
  expect(h.approve).not.toHaveBeenCalled()
  expect(h.changes).not.toHaveBeenCalled()
})

test('modifier combinations are left to the browser', () => {
  const h = handlers()
  renderHook(() => useQueueKeys(h))
  fireEvent.keyDown(window, { key: 'r', ctrlKey: true })
  expect(h.reply).not.toHaveBeenCalled()
})
