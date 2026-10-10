import { expect, test } from 'vitest'

import { originProblem } from './check-site-origin.mjs'

const REPO = 'jmoraispk/delta-review'

test('an unset origin is refused', () => {
  expect(originProblem('', REPO)).toMatch(/Set the DELTA_SITE_ORIGIN/)
})

test('the account-wide github.io origin is refused for a project site', () => {
  // Every project page of the account shares this origin, and with it the
  // localStorage that holds sign-in tokens.
  expect(originProblem('https://jmoraispk.github.io', REPO)).toMatch(/shared/)
  expect(originProblem('https://JMoraisPK.github.io/', REPO)).toMatch(/shared/)
})

test('an origin with a path, or not https, is refused', () => {
  expect(originProblem('https://delta.example.com/review', REPO)).toMatch(/origin only/)
  expect(originProblem('http://delta.example.com', REPO)).toMatch(/https/)
  expect(originProblem('not a url', REPO)).toMatch(/https/)
})

test('a dedicated origin is accepted', () => {
  expect(originProblem('https://delta.example.com', REPO)).toBeNull()
  expect(originProblem('https://delta-review.github.io', REPO)).toBeNull()
  // The account's own root site repository may use the account origin.
  expect(originProblem('https://jmoraispk.github.io', 'jmoraispk/jmoraispk.github.io')).toBeNull()
})
