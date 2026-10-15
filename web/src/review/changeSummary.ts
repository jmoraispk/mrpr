export interface ChangeSummary {
  modified: number
  added: number
  deleted: number
  moved: number
}

/** How the changed files split: new, deleted, renamed, and everything else modified. */
export function summarizeChanges(
  files: { new_file?: boolean; deleted_file?: boolean; renamed_file?: boolean }[],
): ChangeSummary {
  const counts = { modified: 0, added: 0, deleted: 0, moved: 0 }
  for (const file of files) {
    if (file.new_file) counts.added += 1
    else if (file.deleted_file) counts.deleted += 1
    else if (file.renamed_file) counts.moved += 1
    else counts.modified += 1
  }
  return counts
}

/** "15 mod 4 new 0 del", with " 2 mov" only when files were renamed. */
export function changeLine(summary: ChangeSummary): string {
  const base = `${summary.modified} mod ${summary.added} new ${summary.deleted} del`
  return summary.moved ? `${base} ${summary.moved} mov` : base
}
