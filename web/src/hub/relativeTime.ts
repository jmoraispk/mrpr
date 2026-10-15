export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(then).toLocaleDateString()
}

/** A compact age for tight rows: now, 5m, 1h, 2d, 1w, 3mo, 1y. */
export function shortTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const minutes = Math.floor(Math.max(0, now.getTime() - then) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}
