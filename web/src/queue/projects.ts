import type { QueueRow } from './model'

/** The user's own grouping of MRs, so none is forgotten. Lives in this browser. */
export interface Project {
  id: string
  name: string
  color: string
  /** "group/repo" paths and label titles that bring MRs in. */
  rules: { repositories: string[]; labels: string[] }
  /** Row keys moved here by hand. */
  pinned: string[]
}

export const PROJECT_COLORS = ['#C2410C', '#1E4FD8', '#1F6B45', '#8A2E0A', '#6D28D9', '#0E7490']

const NOT_PROJECTS = 'Not a Mr. PR projects file'

const newId = () => Math.random().toString(36).slice(2, 10)

/** Pin first, then a repository rule, then a label rule; null is Unsorted. */
export function projectOf(row: QueueRow, projects: Project[]): Project | null {
  return (
    projects.find((p) => p.pinned.includes(row.key)) ??
    projects.find((p) => p.rules.repositories.includes(row.project)) ??
    projects.find((p) => p.rules.labels.some((label) => row.mr?.labels.includes(label))) ??
    null
  )
}

export function createProject(
  projects: Project[],
  name: string,
  rules: Partial<Project['rules']> = {},
): Project[] {
  return [
    ...projects,
    {
      id: newId(),
      name: name.trim() || 'Untitled',
      color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
      rules: { repositories: rules.repositories ?? [], labels: rules.labels ?? [] },
      pinned: [],
    },
  ]
}

export function deleteProject(projects: Project[], id: string): Project[] {
  return projects.filter((p) => p.id !== id)
}

/** Pin `rowKey` to a project (or to none: Unsorted), removing any other pin. */
export function moveRow(projects: Project[], rowKey: string, projectId: string | null): Project[] {
  return projects.map((p) => ({
    ...p,
    pinned:
      p.id === projectId
        ? [...p.pinned.filter((k) => k !== rowKey), rowKey]
        : p.pinned.filter((k) => k !== rowKey),
  }))
}

export function projectsFromRepositories(projects: Project[], repositories: string[]): Project[] {
  let next = projects
  for (const repository of new Set(repositories)) {
    if (next.some((p) => p.rules.repositories.includes(repository))) continue
    next = createProject(next, repository.split('/').pop() ?? repository, {
      repositories: [repository],
    })
  }
  return next
}

export function exportProjects(projects: Project[]): string {
  return JSON.stringify({ mrpr: 'projects', version: 1, projects }, null, 2)
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

function isProject(value: unknown): value is Project {
  const p = value as Partial<Project> | null
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.id === 'string' &&
    /^[\w-]+$/.test(p.id) &&
    typeof p.name === 'string' &&
    typeof p.color === 'string' &&
    typeof p.rules === 'object' &&
    p.rules !== null &&
    isStrings(p.rules.repositories) &&
    isStrings(p.rules.labels) &&
    isStrings(p.pinned)
  )
}

/** Only well-formed projects, each id once: a damaged value must never reach the app. */
export function normalizeProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.filter((entry): entry is Project => {
    if (!isProject(entry) || seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}

export function importProjects(json: string): Project[] {
  let parsed: { mrpr?: string; projects?: unknown }
  try {
    parsed = JSON.parse(json) as typeof parsed
  } catch {
    throw new Error(NOT_PROJECTS)
  }
  if (parsed?.mrpr !== 'projects' || !Array.isArray(parsed.projects)) {
    throw new Error(NOT_PROJECTS)
  }
  const projects = normalizeProjects(parsed.projects)
  // Refuse rather than silently drop part of what the user meant to import.
  if (projects.length !== parsed.projects.length) throw new Error(NOT_PROJECTS)
  return projects
}
