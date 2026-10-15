import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'

import { liveBox, richEditor } from '../test/richReply'
import { ReplyBox } from './ReplyBox'

// Its own file: React keeps a lazy component once loaded, so only the first
// render in a module sees the editor still loading.
test('what is typed while the editor loads stays in the box and carries into it', async () => {
  const changes = vi.fn()
  function Box() {
    const [value, setValue] = useState('')
    return (
      <ReplyBox
        label="Reply"
        value={value}
        onChange={(markdown) => {
          changes(markdown)
          setValue(markdown)
        }}
        onSubmit={() => {}}
        autoFocus
        initial="@sam "
      />
    )
  }
  render(<Box />)
  // Loading: a real field has the keyboard, so queue keys (a, s) never fire.
  const loading = screen.getByRole('textbox', { name: 'Reply' })
  expect(loading.tagName).toBe('TEXTAREA')
  expect(document.activeElement).toBe(loading)
  expect(loading).toHaveValue('@sam ')
  fireEvent.change(loading, { target: { value: '@sam as said' } })
  expect(changes).toHaveBeenLastCalledWith('@sam as said')

  const live = await liveBox('Reply')
  expect(richEditor(live).getText()).toBe('@sam as said')
})
