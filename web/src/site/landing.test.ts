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

test('the theme toggle and the feature tabs are there for the script to drive', () => {
  expect(page.getElementById('theme-toggle')).not.toBeNull()
  expect(page.getElementById('page')).not.toBeNull()
  expect(page.querySelectorAll('[data-tab]').length).toBe(page.querySelectorAll('[data-pane]').length)
})

test('read-only to start, and no promise of token sign-in', () => {
  expect(html).toMatch(/Read-only access to start/)
  expect(html).not.toMatch(/personal access token/i)
  expect(html).toMatch(/Sign in with your GitLab account\./)
})

test('the GitHub waitlist has its field, its button and a status line', () => {
  expect(page.getElementById('waitlist-email')?.getAttribute('type')).toBe('email')
  expect(page.getElementById('waitlist-join')?.textContent).toMatch(/Join waitlist/)
  expect(page.getElementById('waitlist-status')?.getAttribute('aria-live')).toBe('polite')
})

test('no link on the page goes nowhere', () => {
  for (const link of page.querySelectorAll('a[href^="#"]')) {
    const id = link.getAttribute('href')!.slice(1)
    expect(page.getElementById(id), `#${id}`).not.toBeNull()
  }
  const footer = [...page.querySelectorAll('footer a')].map((a) => [a.textContent, a.getAttribute('href')])
  expect(footer).toEqual([['Privacy', 'privacy/']])
})

test('the privacy page says what the server keeps, and runs no script', () => {
  const privacy = readFileSync(resolve(process.cwd(), 'site/privacy/index.html'), 'utf8')
  const doc = new DOMParser().parseFromString(privacy, 'text/html')
  expect(doc.querySelectorAll('script')).toHaveLength(0)
  expect(doc.title).toMatch(/^Privacy · Mr\. PR/)
  for (const fact of [/never reaches our servers/, /waitlist/i, /Feedback/, /numeric user ID/, /IP address is kept for up to two hours/]) {
    expect(privacy).toMatch(fact)
  }
})

test('it is the Mr. PR page', () => {
  expect(page.title).toMatch(/^Mr\. PR/)
})
