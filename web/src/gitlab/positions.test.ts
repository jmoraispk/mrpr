import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { buildLegacyPosition, buildPosition } from './positions'

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/positions.json'), 'utf-8'),
) as {
  version: { base_sha: string; start_sha: string; head_sha: string }
  cases: {
    name: string
    selection: {
      old_path: string
      new_path: string
      start_old: number | null
      start_new: number | null
      end_old: number | null
      end_new: number | null
    }
    standard: Record<string, unknown>
    legacy: Record<string, unknown>
  }[]
}

for (const testCase of fixture.cases) {
  test(`buildPosition matches Python: ${testCase.name}`, async () => {
    await expect(
      buildPosition(testCase.selection, fixture.version),
    ).resolves.toEqual(testCase.standard)
  })

  test(`buildLegacyPosition matches Python: ${testCase.name}`, async () => {
    await expect(
      buildLegacyPosition(testCase.selection, fixture.version),
    ).resolves.toEqual(testCase.legacy)
  })
}

test('legacy range endpoints carry both coordinate keys', async () => {
  const added = fixture.cases.find((value) => value.name === 'added multiline')!
  const payload = (await buildLegacyPosition(
    added.selection,
    fixture.version,
  )) as { line_range: { start: Record<string, unknown> } }
  expect(Object.keys(payload.line_range.start).sort()).toEqual([
    'line_code',
    'new_line',
    'old_line',
    'type',
  ])
})
