import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, test } from 'vitest'
import userEvent from '@testing-library/user-event'

import { Modal } from './Modal'

function Opener() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? (
        <Modal label="Test" onCancel={() => setOpen(false)}>
          <button type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </Modal>
      ) : null}
    </>
  )
}

test('closing a dialog gives focus back to where it was', async () => {
  const user = userEvent.setup()
  render(<Opener />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
})
