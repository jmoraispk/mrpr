const KEYS: [string, string][] = [
  ['j / k', 'next / previous'],
  ['Space', 'expand or fold the row'],
  ['Enter or o', 'open the MR'],
  ['a', 'approve'],
  ['r', 'reply'],
  ['x', 'request changes'],
  ['n', 'nudge'],
  ['s', 'snooze until it changes'],
  ['m', 'move to project'],
  ['d', 'since last review'],
  ['/', 'search'],
  ['b or Ctrl+B', 'hide or show the sidebar'],
  ['Esc', 'fold the row, leave full screen, or close the MR'],
  ['f', 'full screen'],
  ['?', 'this help'],
]

export function KeyHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="q-help" role="dialog" aria-label="Keyboard shortcuts">
      <dl>
        {KEYS.map(([key, what]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
