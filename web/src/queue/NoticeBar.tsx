import type { Notice } from './useRowActions'

/** The queue's last action, with Undo where it can be undone. */
export function NoticeBar({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: Notice | null
  onUndo: () => void
  onDismiss: () => void
}) {
  if (!notice) return null
  const dismiss = (
    <button type="button" aria-label="Dismiss" onClick={onDismiss}>
      ×
    </button>
  )
  if (notice.kind === 'error') {
    return (
      <div className="q-notice is-error" role="alert">
        <span>{notice.message}</span>
        {dismiss}
      </div>
    )
  }
  if (notice.kind === 'info') {
    return (
      <div className="q-notice" role="status">
        <span>{notice.message}</span>
        {dismiss}
      </div>
    )
  }
  if (notice.kind === 'muted') {
    return (
      <div className="q-notice" role="status">
        <span>
          <strong>Muted</strong> {notice.group.name}
        </span>
        <button type="button" onClick={onUndo}>
          Undo
        </button>
        {dismiss}
      </div>
    )
  }
  return (
    <div className="q-notice" role="status">
      <span>
        <strong>
          {notice.kind === 'approved' ? 'Approved' : notice.kind === 'done' ? 'Marked done' : 'Snoozed'}
        </strong> {notice.row.title}
      </span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
      {dismiss}
    </div>
  )
}
