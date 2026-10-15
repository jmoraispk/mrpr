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
    <Suspense fallback={<div className="rich-reply is-loading" aria-busy="true" />}>
      <RichReply {...props} autoFocus={props.autoFocus || active} />
    </Suspense>
  )
}
