import { shortTime } from '../../hub/relativeTime'

/** A short time ("2d"), with the full one on hover. */
export function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {shortTime(iso)}
    </time>
  )
}
