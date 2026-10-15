import { useQuery } from '@tanstack/react-query'

import type { OverviewNote } from '../../gitlab/mrOverview'
import { useTransport } from '../../transport/context'
import { snippetAt } from './snippetLines'

type Position = NonNullable<OverviewNote['position']>

/** The lines an inline comment was made on, from the diff as it was then. */
export function CodeSnippet({ position }: { position: Position }) {
  const transport = useTransport()
  const { baseSha, headSha } = position
  const diffs = useQuery({
    queryKey: ['diffsBetween', transport.targetKey, baseSha, headSha],
    queryFn: () => transport.getDiffsBetween!(baseSha!, headSha!),
    enabled: Boolean(baseSha && headSha && transport.getDiffsBetween),
    staleTime: Infinity,
    retry: false,
  })
  const file = diffs.data?.find(
    (value) => value.new_path === position.filePath || value.old_path === position.filePath,
  )
  const lines = file ? snippetAt(file.diff, position) : null
  if (!lines) return null
  const line = position.newLine ?? position.oldLine
  return (
    <figure className="mr-snippet" aria-label={`${position.filePath}, line ${line}`}>
      {lines.map((value, index) => (
        <div
          key={index}
          className={`mr-snippet-line is-${value.kind}${value.target ? ' is-target' : ''}`}
        >
          <span className="mr-snippet-no">{value.oldLine ?? ''}</span>
          <span className="mr-snippet-no">{value.newLine ?? ''}</span>
          <code>{value.text || ' '}</code>
        </div>
      ))}
    </figure>
  )
}
