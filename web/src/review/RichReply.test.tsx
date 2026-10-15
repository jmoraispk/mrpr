import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { activeBox, richEditor, typeRich } from '../test/richReply'
import { ReplyBox } from './ReplyBox'

afterEach(() => vi.restoreAllMocks())

function Harness({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const [value, setValue] = useState('')
  return (
    <>
      <ReplyBox label="Reply" value={value} onChange={setValue} onSubmit={onSubmit} />
      <output data-testid="md">{value}</output>
      <button type="button" onClick={() => setValue('')}>
        clear
      </button>
    </>
  )
}

const box = () => screen.findByRole('textbox', { name: 'Reply' })
const md = () => screen.getByTestId('md').textContent
const tool = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

test('an idle box starts no editor until focused', async () => {
  render(<Harness />)
  const idle = await box()
  expect(idle).toHaveClass('rich-reply-idle')
  expect((idle as HTMLElement & { editor?: unknown }).editor).toBeUndefined()
  const live = await activeBox(idle)
  expect(richEditor(live)).toBeTruthy()
  await waitFor(() => expect(live).toHaveFocus())
})

test('Ctrl+B on a selection makes it bold, and Markdown follows', async () => {
  render(<Harness />)
  const input = await typeRich(await box(), 'hello world')
  act(() => {
    richEditor(input).commands.setTextSelection({ from: 7, to: 12 })
  })
  fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
  await waitFor(() => expect(md()).toBe('hello **world**'))
})

test('Ctrl+Shift+X strikes through, Ctrl+E makes code, Ctrl+I italic', async () => {
  render(<Harness />)
  const input = await typeRich(await box(), 'abc')
  const editor = richEditor(input)
  for (const [key, shift, out] of [
    ['x', true, '~~abc~~'],
    ['e', false, '`abc`'],
    ['i', false, '_abc_'],
  ] as const) {
    act(() => {
      editor.commands.unsetAllMarks()
      editor.commands.selectAll()
    })
    act(() => {
      editor.commands.selectAll()
    })
    fireEvent.keyDown(input, { key, ctrlKey: true, shiftKey: shift })
    await waitFor(() => expect(md()).toBe(out))
    act(() => {
      editor.chain().selectAll().unsetAllMarks().run()
    })
  }
})

test('each toolbar button toggles its format and says whether it is on', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  const input = await activeBox(await box())
  for (const [name, out] of [
    ['Bold', '**x**'],
    ['Italic', '_x_'],
    ['Strikethrough', '~~x~~'],
    ['Code', '`x`'],
  ] as const) {
    act(() => {
      richEditor(input).commands.clearContent()
    })
    await user.click(tool(name))
    await typeRich(input, 'x')
    await waitFor(() => expect(md()).toBe(out))
    expect(tool(name)).toHaveAttribute('aria-pressed', 'true')
    await user.click(tool(name))
  }
  expect(screen.queryByRole('button', { name: /^Underline/ })).toBeNull()
})

test('Link asks for an address and links the selection; an empty answer removes it', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  const input = await typeRich(await box(), 'docs')
  act(() => {
    richEditor(input).commands.selectAll()
  })
  vi.spyOn(window, 'prompt').mockReturnValueOnce('https://x.io')
  await user.click(tool('Link'))
  await waitFor(() => expect(md()).toBe('[docs](https://x.io)'))
  act(() => {
    richEditor(input).commands.selectAll()
  })
  vi.spyOn(window, 'prompt').mockReturnValueOnce('')
  await user.click(tool('Link'))
  await waitFor(() => expect(md()).toBe('docs'))
})

test('Ctrl+Enter sends; clearing the value empties the box', async () => {
  const onSubmit = vi.fn()
  const user = userEvent.setup()
  render(<Harness onSubmit={onSubmit} />)
  const input = await typeRich(await box(), 'ship it')
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
  expect(onSubmit).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'clear' }))
  await waitFor(() => expect(richEditor(input).isEmpty).toBe(true))
})

test('a box with initial text starts live, holding it', async () => {
  render(<ReplyBox label="Request changes" value="@ana " onChange={() => {}} onSubmit={() => {}} initial="@ana " />)
  const input = await waitFor(() => {
    const live = document.querySelector<HTMLElement>('.rich-reply-input')
    if (!live) throw new Error('not yet')
    return live
  })
  expect(input).toHaveTextContent('@ana')
})
