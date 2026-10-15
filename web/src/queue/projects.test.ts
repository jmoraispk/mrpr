import { expect, test } from 'vitest'

import type { QueueRow } from './model'
import {
  createProject,
  deleteProject,
  normalizeProjects,
  exportProjects,
  importProjects,
  moveRow,
  projectOf,
  projectsFromRepositories,
  type Project,
} from './projects'

function row(key: string, project: string, labels: string[] = []): QueueRow {
  return {
    key,
    hostId: 'h',
    host: 'h',
    project,
    iid: 1,
    title: 't',
    webUrl: '',
    updatedAt: '',
    score: 0,
    tags: [],
    attention: 'needs-you',
    folded: false,
    minutes: 0,
    newCommits: 0,
    items: [],
    snoozed: false,
    involved: true,
    mr: { labels } as never,
  }
}

test('a pin wins, then a repository rule, then a label rule, else Unsorted', () => {
  let projects: Project[] = []
  projects = createProject(projects, 'SDK', { repositories: ['g/sdk'] })
  projects = createProject(projects, 'Agents', { labels: ['agents'] })
  projects = moveRow(projects, 'h:9', projects[1].id)
  expect(projectOf(row('h:1', 'g/sdk', ['agents']), projects)?.name).toBe('SDK')
  expect(projectOf(row('h:2', 'g/other', ['agents']), projects)?.name).toBe('Agents')
  expect(projectOf(row('h:9', 'g/sdk'), projects)?.name).toBe('Agents')
  expect(projectOf(row('h:3', 'g/other'), projects)).toBeNull()
})

test('moving an MR takes it out of any other project, and back to Unsorted', () => {
  let projects = createProject(createProject([], 'A'), 'B')
  projects = moveRow(projects, 'h:1', projects[0].id)
  projects = moveRow(projects, 'h:1', projects[1].id)
  expect(projects.map((p) => p.pinned)).toEqual([[], ['h:1']])
  projects = moveRow(projects, 'h:1', null)
  expect(projects.every((p) => p.pinned.length === 0)).toBe(true)
})

test('pins to a deleted project are ignored', () => {
  let projects = createProject(createProject([], 'A', { repositories: ['g/a'] }), 'B')
  projects = moveRow(projects, 'h:1', projects[1].id)
  projects = deleteProject(projects, projects[1].id)
  expect(projectOf(row('h:1', 'g/a'), projects)?.name).toBe('A')
})

test('one project per repository, skipping ones already covered', () => {
  const projects = projectsFromRepositories(
    createProject([], 'SDK', { repositories: ['g/sdk'] }),
    ['g/sdk', 'g/sls', 'g/sls'],
  )
  expect(projects.map((p) => [p.name, p.rules.repositories])).toEqual([
    ['SDK', ['g/sdk']],
    ['sls', ['g/sls']],
  ])
})

test('export and import round-trip, and junk is refused', () => {
  const projects = createProject([], 'A', { labels: ['x'] })
  expect(importProjects(exportProjects(projects))).toEqual(projects)
  expect(() => importProjects('{"nope":1}')).toThrow('Not a Mr. PR projects file')
  expect(() => importProjects('junk')).toThrow('Not a Mr. PR projects file')
})

test('an import whose projects are malformed is refused', () => {
  expect(() =>
    importProjects('{"mrpr":"projects","projects":[{"name":"X"}]}'),
  ).toThrow('Not a Mr. PR projects file')
})

test('stored projects are cleaned: junk entries dropped, duplicate ids kept once', () => {
  const good = { id: 'a', name: 'A', color: '#C2410C', rules: { repositories: [], labels: [] }, pinned: [] }
  expect(normalizeProjects([good, { name: 'X' }, null, { ...good, name: 'again' }])).toEqual([good])
  expect(normalizeProjects('nonsense')).toEqual([])
})
