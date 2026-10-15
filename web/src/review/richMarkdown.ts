import type { JSONContent } from '@tiptap/core'

/**
 * The rich reply box's content as GitLab Markdown: bold, italic,
 * strikethrough, code, links, paragraphs, line breaks, lists and code blocks.
 * Characters typed as text stay literal (escaped).
 */
export function toMarkdown(doc: JSONContent): string {
  return (doc.content ?? [])
    .map(block)
    .filter((block) => block !== '')
    .join('\n\n')
    .replace(/\s+$/, '')
}

const SPECIAL = /[\\*_`~[\]<]/g

/** Escapes what Markdown would read as formatting; at a line start also #, >, -, + and "1.". */
export function escapeText(text: string, atLineStart: boolean): string {
  const escaped = text.replace(SPECIAL, '\\$&')
  if (!atLineStart) return escaped
  return escaped.replace(/^([#>+-])/, '\\$1').replace(/^(\d+)\./, '$1\\.')
}

function block(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content ?? [])
    case 'bulletList':
    case 'orderedList':
      return list(node)
    case 'codeBlock':
      return `\`\`\`\n${text(node)}\n\`\`\``
    default:
      return escapeText(text(node), true)
  }
}

function list(node: JSONContent): string {
  const ordered = node.type === 'orderedList'
  const start = Number(node.attrs?.start ?? 1)
  return (node.content ?? [])
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : '- '
      const pad = ' '.repeat(marker.length)
      const lines = (item.content ?? [])
        .map(block)
        .filter((value) => value !== '')
        .join('\n')
        .split('\n')
      return lines.map((line, at) => (at === 0 ? marker + line : line ? pad + line : line)).join('\n')
    })
    .join('\n')
}

function text(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(text).join('')
}

type Run = { text: string; marks: NonNullable<JSONContent['marks']> }

const markKey = (marks: Run['marks']) =>
  marks
    .map((mark) => `${mark.type}:${mark.type === 'link' ? String(mark.attrs?.href ?? '') : ''}`)
    .sort()
    .join('|')

function inline(nodes: JSONContent[]): string {
  // Merge neighbours with the same marks, so "**ab**" not "**a****b**".
  const runs: (Run | 'break')[] = []
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      runs.push('break')
      continue
    }
    if (node.type !== 'text') continue
    const marks = node.marks ?? []
    const last = runs.at(-1)
    if (last && last !== 'break' && markKey(last.marks) === markKey(marks)) last.text += node.text ?? ''
    else runs.push({ text: node.text ?? '', marks })
  }
  let out = ''
  let atLineStart = true
  for (const run of runs) {
    if (run === 'break') {
      out += '\n'
      atLineStart = true
      continue
    }
    out += wrap(run, atLineStart)
    atLineStart = false
  }
  return out
}

function wrap({ text: value, marks }: Run, atLineStart: boolean): string {
  const has = (type: string) => marks.some((mark) => mark.type === type)
  let out: string
  if (has('code')) {
    const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length))
    const fence = '`'.repeat(longest + 1)
    out = longest ? `${fence} ${value} ${fence}` : `${fence}${value}${fence}`
  } else {
    out = escapeText(value, atLineStart && marks.length === 0)
  }
  if (has('strike')) out = `~~${out}~~`
  if (has('italic')) out = `_${out}_`
  if (has('bold')) out = `**${out}**`
  const link = marks.find((mark) => mark.type === 'link')
  if (link) out = `[${out}](${String(link.attrs?.href ?? '')})`
  return out
}
