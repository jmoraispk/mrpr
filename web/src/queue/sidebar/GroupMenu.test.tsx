import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { GroupMenu } from './GroupMenu'

function show(over: Partial<Parameters<typeof GroupMenu>[0]> = {}) {
  const props = {
    name: 'g/sdk',
    canMute: true,
    canUp: false,
    canDown: true,
    onRename: vi.fn(),
    onMute: vi.fn(),
    onUp: vi.fn(),
    onDown: vi.fn(),
    ...over,
  }
  render(<GroupMenu {...props} />)
  return props
}

test('⋮ opens a menu: Rename, Mute repository, Move up (off at the top), Move down', async () => {
  const user = userEvent.setup()
  const props = show()
  await user.click(screen.getByRole('button', { name: 'Options for g/sdk' }))
  const items = screen.getAllByRole('menuitem')
  expect(items.map((item) => item.textContent)).toEqual(['Rename…', 'Mute repository', 'Move up', 'Move down'])
  expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
  expect(items[0]).toHaveFocus()
  await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
  expect(props.onDown).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByRole('button', { name: 'Options for g/sdk' })).toHaveFocus()
})

test('arrows move between enabled items, Escape closes and returns focus; a project has no Mute', async () => {
  const user = userEvent.setup()
  show({ canMute: false })
  await user.click(screen.getByRole('button', { name: 'Options for g/sdk' }))
  expect(screen.queryByRole('menuitem', { name: 'Mute repository' })).toBeNull()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByRole('button', { name: 'Options for g/sdk' })).toHaveFocus()
})

test('a click outside closes the menu', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'Options for g/sdk' }))
  await user.click(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
})
