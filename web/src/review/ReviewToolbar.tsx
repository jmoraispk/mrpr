import type { DiffMode } from './diffWorkerClient'

export const MODE_KEY = 'mrpr-diff-mode'

export interface ReviewToolbarProps {
  inlineCount: number
  mode: DiffMode
  showComments: boolean
  onModeChange: (mode: DiffMode) => void
  onToggleComments: () => void
}

export function ReviewToolbar({
  inlineCount,
  mode,
  showComments,
  onModeChange,
  onToggleComments,
}: ReviewToolbarProps) {
  function chooseMode(nextMode: DiffMode) {
    localStorage.setItem(MODE_KEY, nextMode)
    onModeChange(nextMode)
  }

  return (
    <div className="review-toolbar" role="toolbar" aria-label="Review controls">
      {inlineCount > 0 ? (
        <button
          className="comment-visibility-toggle"
          aria-pressed={showComments}
          type="button"
          onClick={onToggleComments}
        >
          {showComments ? 'Hide' : 'Show'} inline comments ({inlineCount})
        </button>
      ) : null}
      <div className="view-control" aria-label="Diff view">
        <button
          aria-pressed={mode === 'unified'}
          className={mode === 'unified' ? 'is-selected' : ''}
          type="button"
          onClick={() => chooseMode('unified')}
        >
          Unified
        </button>
        <button
          aria-pressed={mode === 'split'}
          className={mode === 'split' ? 'is-selected' : ''}
          type="button"
          onClick={() => chooseMode('split')}
        >
          Split
        </button>
      </div>
    </div>
  )
}
