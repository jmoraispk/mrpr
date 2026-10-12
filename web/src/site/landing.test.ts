import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

// vitest runs from web/; jsdom gives import.meta.url a non-file scheme.
const html = readFileSync(resolve(process.cwd(), 'site/index.html'), 'utf8')
const page = new DOMParser().parseFromString(html, 'text/html')
const links = (name: RegExp) =>
  [...page.querySelectorAll('a')].filter((a) => name.test(a.textContent ?? ''))

test('every sign-in and connect button opens the app', () => {
  const entries = [...links(/^\s*Sign in\s*$/), ...links(/Connect GitLab/)]
  expect(entries.length).toBeGreaterThanOrEqual(4)
  for (const link of entries) expect(link.getAttribute('href')).toBe('app/')
})

test('the landing page runs only its own script file, never inline code', () => {
  // It shares the app's origin and tokens; the policy allows 'self' scripts only.
  const scripts = [...page.querySelectorAll('script')]
  expect(scripts.map((script) => script.getAttribute('src'))).toEqual(['/landing.js'])
  expect(scripts.every((script) => !script.textContent?.trim())).toBe(true)
})

test('the theme toggle is there for the script to drive', () => {
  expect(page.getElementById('theme-toggle')).not.toBeNull()
  expect(page.getElementById('page')).not.toBeNull()
})

test('it promises faster work on MRs, not read-only access', () => {
  expect(html).not.toMatch(/Read-only access/i)
  expect(html).toMatch(/faster from the dashboard/i)
})

test('it is the Mr. PR page', () => {
  expect(page.title).toMatch(/^Mr\. PR/)
})
