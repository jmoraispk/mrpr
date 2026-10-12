const KEYS: [string, string][] = [
  ['j / k', 'next / previous'],
  ['Enter or o', 'open review'],
  ['a', 'approve'],
  ['r', 'reply'],
  ['x', 'request changes'],
  ['n', 'nudge'],
  ['s', 'snooze until it changes'],
  ['m', 'move to project'],
  ['d', 'since last review'],
  ['g n / g r / g w / g q', 'jump to a bucket'],
  ['g p', 'go to projects'],
  ['Esc', 'close the MR (or leave full screen)'],
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
