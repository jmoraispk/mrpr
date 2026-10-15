import { useEffect, useState } from 'react'

import { shortTime } from '../../hub/relativeTime'

/** ↻ and how long ago the list was read; a click reads it again. */
export function RefreshButton({
  updatedAt,
  refreshing,
  onRefresh,
}: {
  updatedAt: number
  refreshing: boolean
  onRefresh: () => void
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [updatedAt])
  const age = updatedAt ? shortTime(new Date(updatedAt).toISOString(), now) : ''
  const label = refreshing
    ? 'Refreshing'
    : age === 'now'
      ? 'Refresh, updated just now'
      : age
        ? `Refresh, updated ${age} ago`
        : 'Refresh'
  return (
    <button
      type="button"
      className="sb-refresh"
      aria-label={label}
      title={label}
      disabled={refreshing}
      onClick={onRefresh}
    >
      ↻ {refreshing ? '…' : age}
    </button>
  )
}
