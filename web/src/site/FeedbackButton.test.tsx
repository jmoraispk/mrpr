import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import { server } from '../test/server'
import { sendFeedback } from './feedback'
import { FeedbackButton } from './FeedbackButton'

test('Feedback opens one text box and an optional email, and says thanks once sent', async () => {
  const user = userEvent.setup()
  const send = vi.fn(async () => {})
  render(<FeedbackButton send={send} />)
  await user.click(screen.getByRole('button', { name: 'Feedback' }))
  const dialog = screen.getByRole('dialog', { name: 'Feedback' })
  expect(dialog).toHaveTextContent('Only what you type is sent, with the app version and your browser.')
  await user.type(screen.getByRole('textbox', { name: "What's rough or missing?" }), 'Nudges are great')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(send).toHaveBeenCalledWith({ message: 'Nudges are great', email: '' })
  expect(await screen.findByText('Thanks. We read every message.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('a failed send keeps the text and says so', async () => {
  const user = userEvent.setup()
  render(<FeedbackButton send={async () => Promise.reject(new Error('down'))} />)
  await user.click(screen.getByRole('button', { name: 'Feedback' }))
  const box = screen.getByRole('textbox', { name: "What's rough or missing?" })
  await user.type(box, 'Keep this')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send it. Your text is still here.")
  expect(box).toHaveValue('Keep this')
})

test('a blank message is not sent', async () => {
  const user = userEvent.setup()
  const send = vi.fn(async () => {})
  render(<FeedbackButton send={send} />)
  await user.click(screen.getByRole('button', { name: 'Feedback' }))
  await user.type(screen.getByRole('textbox', { name: "What's rough or missing?" }), '   ')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(send).not.toHaveBeenCalled()
})

test('sendFeedback posts only the message, the email if given, the version and the browser', async () => {
  const bodies: unknown[] = []
  server.use(
    http.post('*/api/feedback/', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json({ ok: true })
    }),
  )
  await sendFeedback({ message: ' Hi ', email: '' })
  await sendFeedback({ message: 'Hi', email: ' a@b.co ' })
  expect(bodies[0]).toEqual({ message: 'Hi', version: 'dev', browser: navigator.userAgent })
  expect(bodies[1]).toEqual({ message: 'Hi', email: 'a@b.co', version: 'dev', browser: navigator.userAgent })
  server.use(http.post('*/api/feedback/', () => HttpResponse.json({}, { status: 500 })))
  await expect(sendFeedback({ message: 'x', email: '' })).rejects.toThrow()
})
