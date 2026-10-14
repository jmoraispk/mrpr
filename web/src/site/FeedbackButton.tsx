import { useState, type FormEvent } from 'react'

import { sendFeedback, type FeedbackInput } from './feedback'
import { Modal } from './Modal'

type State = 'idle' | 'sending' | 'sent' | 'failed'

/** Always in the corner: one text box, an optional email, and nothing attached. */
export function FeedbackButton({
  send = sendFeedback,
}: {
  send?: (input: FeedbackInput) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="q-feedback q-tokens" onClick={() => setOpen(true)}>
        Feedback
      </button>
      {open ? <FeedbackDialog send={send} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function FeedbackDialog({
  send,
  onClose,
}: {
  send: (input: FeedbackInput) => Promise<void>
  onClose: () => void
}) {
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!message.trim() || state === 'sending') return
    setState('sending')
    try {
      await send({ message, email })
      setMessage('')
      setEmail('')
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <Modal label="Feedback" onCancel={onClose}>
      {state === 'sent' ? (
        <>
          <p className="q-modal-title">Thanks. We read every message.</p>
          <div className="q-modal-actions">
            <button type="button" className="q-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form className="q-modal-form" onSubmit={(event) => void submit(event)}>
          <label>
            What's rough or missing?
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={6}
              maxLength={5000}
              autoFocus
            />
          </label>
          <label>
            Email (optional, if you'd like a reply)
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
          <p className="q-modal-note">
            Only what you type is sent, with the app version and your browser.
          </p>
          {state === 'failed' ? (
            <p className="mutation-error" role="alert">
              Couldn't send it. Your text is still here.
            </p>
          ) : null}
          <div className="q-modal-actions">
            <button type="submit" className="q-primary" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Send'}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
