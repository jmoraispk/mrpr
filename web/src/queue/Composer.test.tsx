import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { ApiError } from '../api/client'
import { Composer } from './Composer'

test('a post refused for want of posting rights says so, and keeps the text', async () => {
  const user = userEvent.setup()
  const refused = new ApiError(403, 'Posting needs your OK in GitLab.', 'write_access_denied')
  render(<Composer label="Reply" initial="" onCancel={() => {}} onSend={() => Promise.reject(refused)} />)
  await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Looks good')
  await user.click(screen.getByRole('button', { name: 'Post' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Posting needs your OK in GitLab. Your text is still here.',
  )
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Looks good')
})
