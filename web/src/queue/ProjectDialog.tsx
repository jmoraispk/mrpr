import { useState, type FormEvent } from 'react'

import { createProject } from './projects'
import { useProjects } from './state'

const list = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

/** A new project: a name, and optionally the repositories and labels it collects. */
export function ProjectDialog({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useProjects()
  const [name, setName] = useState('')
  const [repositories, setRepositories] = useState('')
  const [labels, setLabels] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    setProjects(
      createProject(projects, name, { repositories: list(repositories), labels: list(labels) }),
    )
    onClose()
  }

  return (
    <form className="q-dialog" aria-label="New project" onSubmit={submit}>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </label>
      <label>
        Repositories (optional, comma-separated)
        <input
          value={repositories}
          placeholder="group/repo"
          onChange={(event) => setRepositories(event.target.value)}
        />
      </label>
      <label>
        Labels (optional, comma-separated)
        <input value={labels} onChange={(event) => setLabels(event.target.value)} />
      </label>
      <div className="q-composer-actions">
        <button type="submit" className="q-primary">
          Create project
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  )
}
