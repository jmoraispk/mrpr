import { useId, useState, type FormEvent } from 'react'

/** A comment box for reply, request changes and nudge. Posts are signed by the router. */
export function Composer({
  initial,
  label,
  onSend,
  onCancel,
}: {
  initial: string
  label: string
  onSend: (body: string) => Promise<unknown>
  onCancel: () => void
}) {
  const id = useId()
  const [body, setBody] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    try {
      await onSend(body)
      onCancel()
    } catch (error) {
      setError(
        (error as { code?: string } | null)?.code === 'write_access_denied'
          ? 'Posting needs your OK in GitLab. Your text is still here.'
          : "Couldn't post it. Your text is still here; try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="q-composer" onSubmit={(event) => void submit(event)}>
      <label className="q-composer-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        value={body}
        autoFocus
        rows={4}
        onChange={(event) => setBody(event.target.value)}
        // Start typing after the prefilled mention.
        onFocus={(event) => event.target.setSelectionRange(body.length, body.length)}
      />
      <p className="q-signed">Signed — via Mr. PR</p>
      {error ? (
        <p className="mutation-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="q-composer-actions">
        <button type="submit" className="q-primary" disabled={busy}>
          {busy ? 'Posting…' : 'Post'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
