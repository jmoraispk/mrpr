import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { ApiError } from '../api/client'
import { richEditor, typeRich } from '../test/richReply'
import { Composer } from './Composer'

test('a post refused for want of posting rights says so, and keeps the text', async () => {
  const user = userEvent.setup()
  const refused = new ApiError(403, 'Posting needs your OK in GitLab.', 'write_access_denied')
  render(<Composer label="Reply" initial="" onCancel={() => {}} onSend={() => Promise.reject(refused)} />)
  const input = await typeRich(await screen.findByRole('textbox', { name: 'Reply' }), 'Looks good')
  await user.click(screen.getByRole('button', { name: 'Post' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Posting needs your OK in GitLab. Your text is still here.',
  )
  expect(richEditor(input).getText()).toBe('Looks good')
})

test('the composer is a rich box that starts with its mention and posts Markdown', async () => {
  const user = userEvent.setup()
  const sent: string[] = []
  render(
    <Composer
      label="Request changes"
      initial="@ana "
      onCancel={() => {}}
      onSend={async (body) => {
        sent.push(body)
      }}
    />,
  )
  const input = await waitFor(() => {
    const live = document.querySelector<HTMLElement>('.rich-reply-input')
    if (!live) throw new Error('not yet')
    return live
  })
  expect(input).toHaveAttribute('aria-label', 'Request changes')
  await typeRich(input, 'rename _this_')
  await user.click(screen.getByRole('button', { name: 'Post' }))
  await waitFor(() => expect(sent).toEqual(['@ana rename \\_this\\_']))
})
