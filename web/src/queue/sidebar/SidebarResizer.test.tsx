import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { SidebarResizer } from './SidebarResizer'

function show(width = 360) {
  const onResize = vi.fn()
  const onResizeEnd = vi.fn()
  render(<SidebarResizer width={width} onResize={onResize} onResizeEnd={onResizeEnd} />)
  return { handle: screen.getByRole('separator', { name: 'Resize the sidebar' }), onResize, onResizeEnd }
}

test('the handle says its width and limits', () => {
  const { handle } = show(400)
  expect(handle).toHaveAttribute('aria-valuenow', '400')
  expect(handle).toHaveAttribute('aria-valuemin', '260')
  expect(handle).toHaveAttribute('aria-valuemax', '600')
})

test('arrow keys resize by 16, with Shift by 48, and Home resets', () => {
  const { handle, onResizeEnd } = show(360)
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
  fireEvent.keyDown(handle, { key: 'Home' })
  expect(onResizeEnd.mock.calls).toEqual([[376], [312], [360]])
})

test('a double-click resets the width', () => {
  const { handle, onResizeEnd } = show(500)
  fireEvent.doubleClick(handle)
  expect(onResizeEnd).toHaveBeenCalledWith(360)
})

test('dragging resizes as it goes and saves on release', () => {
  const { handle, onResize, onResizeEnd } = show(360)
  fireEvent.pointerDown(handle, { clientX: 360, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: 420, pointerId: 1 })
  fireEvent.pointerUp(handle, { clientX: 450, pointerId: 1 })
  expect(onResize).toHaveBeenCalledWith(420)
  expect(onResizeEnd).toHaveBeenCalledWith(450)
})

test('dragging past the limits stops at them', () => {
  const { handle, onResize, onResizeEnd } = show(360)
  fireEvent.pointerDown(handle, { clientX: 360, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: 5000, pointerId: 1 })
  fireEvent.pointerUp(handle, { clientX: -50, pointerId: 1 })
  expect(onResize).toHaveBeenCalledWith(600)
  expect(onResizeEnd).toHaveBeenCalledWith(260)
  // Released: moving again changes nothing.
  fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 })
  expect(onResize).toHaveBeenCalledTimes(1)
})
