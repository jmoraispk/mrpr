import { lazy, Suspense, useState } from 'react'

export interface ReplyBoxProps {
  label: string
  /** The Markdown so far; set it to '' after a successful post to clear the box. */
  value: string
  onChange: (markdown: string) => void
  onSubmit: () => void
  autoFocus?: boolean
  /** Text the box starts with (e.g. an @mention), as plain text. */
  initial?: string
  disabled?: boolean
}

const RichReply = lazy(() => import('./RichReply'))

/**
 * A reply box. Idle it is a plain field, so a page of threads starts no
 * editors; focusing or clicking it starts the rich editor (downloaded once).
 */
export function ReplyBox(props: ReplyBoxProps) {
  const [active, setActive] = useState(false)
  // What was typed while the editor was still loading; the editor starts with it.
  const [typed, setTyped] = useState<string | null>(null)
  const live = active || props.autoFocus || Boolean(props.value) || Boolean(props.initial)
  if (!live) {
    return (
      <div
        role="textbox"
        tabIndex={0}
        aria-label={props.label}
        aria-multiline="true"
        className="rich-reply-idle"
        data-placeholder={`${props.label}…`}
        onFocus={() => setActive(true)}
        onMouseDown={() => setActive(true)}
      />
    )
  }
  return (
    <Suspense
      fallback={
        // A real field while the editor downloads, so keys typed meanwhile
        // land here (never on the queue's shortcuts) and carry into it.
        <textarea
          className="rich-reply is-loading"
          aria-label={props.label}
          aria-busy="true"
          autoFocus={props.autoFocus || active}
          onFocus={(event) => {
            const end = event.currentTarget.value.length
            event.currentTarget.setSelectionRange(end, end)
          }}
          value={typed ?? props.initial ?? ''}
          onChange={(event) => {
            setTyped(event.target.value)
            props.onChange(event.target.value)
          }}
          disabled={props.disabled}
        />
      }
    >
      <RichReply {...props} initial={typed ?? props.initial} autoFocus={props.autoFocus || active} />
    </Suspense>
  )
}
