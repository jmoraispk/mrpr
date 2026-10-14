import { useState, type FormEvent } from 'react'

import { FeedbackError, sendFeedback, type FeedbackInput } from './feedback'
import { Modal } from './Modal'

type State = 'idle' | 'sending' | 'sent' | 'blank' | 'bad_email' | 'failed'

const PROBLEMS: Partial<Record<State, string>> = {
  blank: 'Write a message first.',
  bad_email: "That email doesn't look right.",
  failed: "Couldn't send it. Your text is still here.",
}

/** Always in the corner: one text box, an optional email, and nothing attached. */
export function FeedbackButton({
  send = sendFeedback,
}: {
  send?: (input: FeedbackInput) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  // Held here, so a draft survives closing the dialog until it is sent.
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (state === 'sending') return
    if (!message.trim()) {
      setState('blank')
      return
    }
    setState('sending')
    try {
      await send({ message, email })
      setMessage('')
      setEmail('')
      setState('sent')
    } catch (error) {
      setState(error instanceof FeedbackError && error.code === 'bad_email' ? 'bad_email' : 'failed')
    }
  }

  const close = () => {
    setOpen(false)
    if (state === 'sent' || state === 'blank') setState('idle')
  }

  return (
    <>
      <button type="button" className="q-feedback q-tokens" onClick={() => setOpen(true)}>
        Feedback
      </button>
      {open ? (
        <Modal label="Feedback" onCancel={close}>
          {state === 'sent' ? (
            <>
              <p className="q-modal-title">Thanks. We read every message.</p>
              <div className="q-modal-actions">
                <button type="button" className="q-primary" onClick={close}>
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
              {PROBLEMS[state] ? (
                <p className="mutation-error" role="alert">
                  {PROBLEMS[state]}
                </p>
              ) : null}
              <div className="q-modal-actions">
                <button type="submit" className="q-primary" disabled={state === 'sending'}>
                  {state === 'sending' ? 'Sending…' : 'Send'}
                </button>
                <button type="button" onClick={close}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </Modal>
      ) : null}
    </>
  )
}
