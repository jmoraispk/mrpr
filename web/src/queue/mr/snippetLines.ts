export interface SnippetLine {
  kind: 'add' | 'del' | 'ctx'
  oldLine: number | null
  newLine: number | null
  text: string
  /** The line the comment is on. */
  target: boolean
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * The commented line of a unified diff and up to `context` lines above it
 * from the same hunk. A comment on a new or unchanged line is found by its
 * new number; one on a removed line by its old number. Null when not there.
 */
export function snippetAt(
  diff: string,
  line: { newLine: number | null; oldLine: number | null },
  context = 3,
): SnippetLine[] | null {
  let hunk: SnippetLine[] = []
  let inHunk = false
  let oldNo = 0
  let newNo = 0
  for (const raw of diff.split('\n')) {
    const header = HUNK.exec(raw)
    if (header) {
      hunk = []
      inHunk = true
      oldNo = Number(header[1])
      newNo = Number(header[2])
      continue
    }
    if (!inHunk || raw.startsWith('\\')) continue
    const mark = raw[0]
    const text = raw.slice(1)
    let entry: SnippetLine
    if (mark === '+') entry = { kind: 'add', oldLine: null, newLine: newNo++, text, target: false }
    else if (mark === '-') entry = { kind: 'del', oldLine: oldNo++, newLine: null, text, target: false }
    else if (mark === ' ') entry = { kind: 'ctx', oldLine: oldNo++, newLine: newNo++, text, target: false }
    else continue
    hunk.push(entry)
    const hit =
      line.newLine !== null
        ? entry.newLine === line.newLine
        : line.oldLine !== null && entry.kind !== 'add' && entry.oldLine === line.oldLine
    if (hit) {
      entry.target = true
      return hunk.slice(-(context + 1))
    }
  }
  return null
}
